import type { Clock } from '../../../shared/time/Clock.js';
import { webhookSecretNotFound, webhookSignatureInvalid } from '../domain/errors/IngestError.js';
import { ProviderIngestEvent } from '../domain/model/aggregates/ProviderIngestEvent.js';
import { generateProviderIngestEventId } from '../domain/model/value-objects/ProviderIngestEventId.js';
import { createPaymentProvider, type PaymentProvider } from '../domain/model/value-objects/PaymentProvider.js';
import type { InboundWebhookSecretRepository } from '../domain/ports/InboundWebhookSecretRepository.js';
import type { PostAckComposer } from '../domain/ports/PostAckComposer.js';
import type {
  EnvelopeMapResult,
  PaymentCustomerLookup,
  ProviderEnvelopeMapper,
} from '../domain/ports/ProviderEnvelopeMapper.js';
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
  /**
   * Optional: resolves the customer of events that only name an earlier
   * payment (Stripe disputes). Without it those events stay FAILED with
   * `missing_customer`, exactly as before.
   */
  readonly paymentCustomers?: PaymentCustomerLookup;
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

    return ingestPayload(
      deps,
      { organizationId: input.organizationId, provider, payload: parseJson(input.rawBody), rawBody: input.rawBody },
      (compose) => {
        schedule(() => {
          void compose().catch(onPostAckError);
        });
      },
    );
  };
}

export type IngestPolledProviderEventDeps = Omit<
  ReceiveProviderWebhookDeps,
  'secrets' | 'cipher' | 'verifiers' | 'schedulePostAck' | 'onPostAckError'
>;

export interface IngestPolledProviderEventInput {
  readonly organizationId: string;
  readonly provider: string;
  /** The provider's object, shaped exactly as its webhook would deliver it. */
  readonly payload: Record<string, unknown>;
}

/**
 * The same ingestion as a webhook — idempotency row, mapping, payment
 * history, scoring, case — for an event this service went and FETCHED from
 * the provider (see `PollProviderEvents`). There is no signature to verify:
 * the payload comes from the provider's API through api-business, not from
 * an inbound request. The scoring runs before returning, so a poll does not
 * pile up hundreds of concurrent compositions.
 *
 * The idempotency key is the provider event id, the same one a webhook
 * carries: an event received both ways is processed once.
 */
export function createIngestPolledProviderEventUseCase(deps: IngestPolledProviderEventDeps) {
  return async function ingestPolledProviderEvent(
    input: IngestPolledProviderEventInput,
  ): Promise<ReceiveProviderWebhookResult> {
    const provider = createPaymentProvider(input.provider);
    return ingestPayload(
      deps,
      {
        organizationId: input.organizationId,
        provider,
        payload: input.payload,
        rawBody: Buffer.from(JSON.stringify(input.payload)),
      },
      (compose) => compose(),
    );
  };
}

async function ingestPayload(
  deps: IngestPolledProviderEventDeps,
  input: {
    readonly organizationId: string;
    readonly provider: PaymentProvider;
    readonly payload: unknown;
    readonly rawBody: Buffer;
  },
  dispatch: (compose: () => Promise<void>) => Promise<void> | void,
): Promise<ReceiveProviderWebhookResult> {
  const { organizationId, provider, payload } = input;
  const firstPass = resolveMappedResult(payload, provider, deps.mapper);
  const mapped = await retryWithReferencedCustomer(deps, organizationId, provider, payload, firstPass);

  const providerEventId = resolveProviderEventId(provider, payload, mapped, input.rawBody);
  const now = deps.clock.now();
  const row = ProviderIngestEvent.create({
    id: generateProviderIngestEventId(),
    organizationId,
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
    await dispatch(() => deps.composer.compose({ organizationId, provider, event, ingestEventId }));
    return { status: 'PROCESSED' };
  }

  return { status: mapped.status === 'ignored' ? 'IGNORED' : 'FAILED' };
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

/**
 * Second mapping pass for an event whose customer lives on an earlier
 * payment. Runs before the idempotency row is written, so the row's status
 * reflects the final outcome. A payment never seen before leaves the first
 * result untouched.
 */
async function retryWithReferencedCustomer(
  deps: Pick<ReceiveProviderWebhookDeps, 'paymentCustomers' | 'mapper'>,
  organizationId: string,
  provider: PaymentProvider,
  payload: unknown,
  firstPass: EnvelopeMapResult,
): Promise<EnvelopeMapResult> {
  if (
    firstPass.status !== 'failed' ||
    firstPass.reason !== 'missing_customer' ||
    firstPass.providerReference === undefined ||
    deps.paymentCustomers === undefined
  ) {
    return firstPass;
  }
  const customerId = await deps.paymentCustomers.findCustomerId(organizationId, provider, firstPass.providerReference);
  return customerId === null ? firstPass : deps.mapper.map(provider, payload, { customerId });
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
