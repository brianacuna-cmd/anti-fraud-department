import type { Clock } from '../../../shared/time/Clock.js';
import { webhookSecretNotFound, webhookSignatureInvalid } from '../domain/errors/IngestError.js';
import { ProviderIngestEvent } from '../domain/model/aggregates/ProviderIngestEvent.js';
import { generateProviderIngestEventId } from '../domain/model/value-objects/ProviderIngestEventId.js';
import { createPaymentProvider, type PaymentProvider } from '../domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../domain/ports/InboundWebhookSecretRepository.js';
import type { PostAckComposer } from '../domain/ports/PostAckComposer.js';
import type { EnvelopeMapResult, ProviderEnvelopeMapper } from '../domain/ports/ProviderEnvelopeMapper.js';
import type { ProviderIngestEventRepository } from '../domain/ports/ProviderIngestEventRepository.js';
import type { SecretCipher } from '../domain/ports/SecretCipher.js';
import type { WebhookSignatureVerifier } from '../domain/ports/WebhookSignatureVerifier.js';

export interface ReceiveProviderWebhookInput {
  readonly organizationId: string;
  readonly provider: string;
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface ReceiveProviderWebhookResult {
  readonly status: 'PROCESSED' | 'IGNORED' | 'DUPLICATE' | 'FAILED';
}

export interface ReceiveProviderWebhookDeps {
  readonly secrets: InboundWebhookSecretRepository;
  readonly events: ProviderIngestEventRepository;
  readonly cipher: SecretCipher;
  readonly verifiers: (provider: PaymentProvider) => WebhookSignatureVerifier;
  readonly mapper: ProviderEnvelopeMapper;
  readonly composer: PostAckComposer;
  readonly clock: Clock;
  readonly schedulePostAck?: (work: () => void) => void;
  readonly onPostAckError?: (error: unknown) => void;
}

const DUPLICATE_KEY_CODE = 11000;

function defaultOnPostAckError(error: unknown): void {
  console.error('postAck', error);
}

export function createReceiveProviderWebhookUseCase(deps: ReceiveProviderWebhookDeps) {
  const schedule = deps.schedulePostAck ?? ((work: () => void) => setImmediate(work));
  const onPostAckError = deps.onPostAckError ?? defaultOnPostAckError;

  return async function receiveProviderWebhook(
    input: ReceiveProviderWebhookInput,
  ): Promise<ReceiveProviderWebhookResult> {
    const provider = createPaymentProvider(input.provider);
    await verifyFailClosed(deps, input, provider);

    const payload = parseJson(input.rawBody);
    const mapped = resolveMappedResult(payload, provider, deps.mapper);

    const providerEventId = resolveProviderEventId(provider, payload, mapped, input.rawBody);
    const now = deps.clock.now();
    const row = ProviderIngestEvent.create({
      id: generateProviderIngestEventId(),
      organizationId: input.organizationId,
      provider,
      providerEventId,
      status: initialStatus(mapped),
      now,
    });

    const insertOutcome = await insertIgnoringDuplicate(deps.events, row);
    if (insertOutcome === 'duplicate') {
      return { status: 'DUPLICATE' };
    }

    if (mapped.status === 'mapped') {
      const event = mapped.event;
      const ingestEventId = row.id;
      schedule(() => {
        void deps.composer
          .compose({
            organizationId: input.organizationId,
            provider,
            event,
            ingestEventId,
          })
          .catch(onPostAckError);
      });
      return { status: 'PROCESSED' };
    }

    return { status: mapped.status === 'ignored' ? 'IGNORED' : 'FAILED' };
  };
}

async function verifyFailClosed(
  deps: ReceiveProviderWebhookDeps,
  input: ReceiveProviderWebhookInput,
  provider: PaymentProvider,
): Promise<void> {
  const secretRow = await deps.secrets.findByOrgProvider(input.organizationId, provider);
  if (secretRow === null) {
    throw webhookSecretNotFound(input.organizationId, provider);
  }
  const plaintext = deps.cipher.decrypt(secretRow.ciphertext);
  if (plaintext === null) {
    throw webhookSecretNotFound(input.organizationId, provider);
  }
  const verified = deps.verifiers(provider).verify(input.rawBody, input.headers, plaintext);
  if (!verified) {
    throw webhookSignatureInvalid();
  }
}

async function insertIgnoringDuplicate(
  events: ProviderIngestEventRepository,
  row: ProviderIngestEvent,
): Promise<'inserted' | 'duplicate'> {
  try {
    return await events.insertUnique(row);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return 'duplicate';
    }
    throw error;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY_CODE;
}

/**
 * Resolves the envelope mapping outcome. `payload === undefined` means the
 * raw JSON body itself failed to parse (REQ-E3) — distinct from a mapper
 * reporting `unparsable_amount` for a genuine amount-parse failure on an
 * otherwise-valid payload. Exported for direct unit testing since `mapped`
 * is otherwise local to `receiveProviderWebhook` and not observable.
 */
export function resolveMappedResult(
  payload: unknown,
  provider: PaymentProvider,
  mapper: ProviderEnvelopeMapper,
): EnvelopeMapResult {
  return payload === undefined
    ? { status: 'failed', reason: 'unparseable_body' }
    : mapper.map(provider, payload);
}

function initialStatus(mapped: EnvelopeMapResult): 'RECEIVED' | 'IGNORED' | 'FAILED' {
  if (mapped.status === 'mapped') {
    return 'RECEIVED';
  }
  if (mapped.status === 'ignored') {
    return 'IGNORED';
  }
  return 'FAILED';
}

function parseJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function resolveProviderEventId(
  provider: PaymentProvider,
  payload: unknown,
  mapped: EnvelopeMapResult,
  rawBody: Buffer,
): string {
  if (mapped.status === 'mapped' && mapped.event.providerEventId) {
    return mapped.event.providerEventId;
  }
  const fromPayload = extractIdFromPayload(provider, payload);
  return fromPayload ?? `unparsed:${rawBody.length}:${hashSeed(rawBody)}`;
}

function extractIdFromPayload(provider: PaymentProvider, payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (provider === 'stripe') {
    return nonEmptyString(payload.id);
  }
  if (provider === 'bridge') {
    return nonEmptyString(payload.event_id);
  }
  return coinflowCompositeId(payload);
}

function coinflowCompositeId(payload: Record<string, unknown>): string {
  const eventType = typeof payload.eventType === 'string' ? payload.eventType : '';
  const data = isRecord(payload.data) ? payload.data : {};
  const dataId = typeof data.id === 'string' ? data.id : '';
  const created = typeof payload.created === 'string' ? payload.created : String(payload.created ?? '');
  return `${eventType}:${dataId}:${created}`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Weak 32-bit rolling hash — collision risk exists for the synthetic
 * `unparsed:{length}:{hash}` fallback id used only when no real
 * provider/idempotency id can be extracted from the payload. Low urgency
 * (E9, descoped from this slice per design): a real hash (e.g.
 * `crypto.createHash('sha256')`) would remove the collision risk if this
 * fallback id path is ever relied on for correctness beyond best-effort
 * dedupe.
 */
function hashSeed(rawBody: Buffer): string {
  let hash = 0;
  for (const byte of rawBody) {
    hash = (hash * 31 + byte) | 0;
  }
  return String(hash >>> 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
