import { oid } from '../../../support/oid.js';
import { createCustomerOutgoingEventDispatcher } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/CustomerOutgoingEventDispatcher.js';
import { CustomerOutgoingEvent } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { createCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { FakeOutgoingWebhookClient } from '../../../helpers/case-management/FakeOutgoingWebhookClient.js';
import { ControllableClock } from '../../../helpers/ControllableClock.js';
import { FakeSleeper } from '../../../helpers/FakeSleeper.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const T0 = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const WEBHOOK_URL = 'https://hooks.example/fraud';
const PAYLOAD = {
  enforcement_action_id: oid('action-1'),
  case_id: oid('case-1'),
  action_type: 'BLOCK',
  target_type: 'CUSTOMER',
  target_id: oid('customer-1'),
  organization_id: oid('org-1'),
} as const;

/** Matches claimPending BACKOFF_SECONDS[attempts] after each failure (attempts 1..4 → 2,4,8,16). */
const BACKOFF_AFTER_ATTEMPTS = [2, 4, 8, 16] as const;

function buildPending(overrides: Partial<Parameters<typeof CustomerOutgoingEvent.create>[0]> = {}) {
  return CustomerOutgoingEvent.create({
    id: createCustomerOutgoingEventId(oid('outbox-dispatch-1')),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    enforcementActionId: createEnforcementActionId(oid('action-1')),
    webhookUrl: WEBHOOK_URL,
    eventType: 'ENFORCEMENT_EXECUTED',
    payload: PAYLOAD,
    now: T0,
    ...overrides,
  });
}

function buildDispatcher(opts?: {
  clock?: ControllableClock;
  client?: FakeOutgoingWebhookClient;
  events?: InMemoryCustomerOutgoingEventRepository;
  sleeper?: FakeSleeper;
  claimLimit?: number;
  fraudConfig?: InMemoryOrganizationFraudConfigRepository;
}) {
  const clock = opts?.clock ?? new ControllableClock(T0);
  const client = opts?.client ?? new FakeOutgoingWebhookClient();
  const events = opts?.events ?? new InMemoryCustomerOutgoingEventRepository();
  const sleeper = opts?.sleeper ?? new FakeSleeper();
  const dispatcher = createCustomerOutgoingEventDispatcher({
    outgoingEvents: events,
    webhookClient: client,
    clock,
    sleeper: (ms) => sleeper.sleep(ms),
    claimLimit: opts?.claimLimit,
    ...(opts?.fraudConfig === undefined ? {} : { fraudConfig: opts.fraudConfig }),
  });
  return { dispatcher, clock, client, events, sleeper };
}

describe('CustomerOutgoingEventDispatcher', () => {
  it('marks PENDING events SENT on HTTP 2xx and posts the outbox payload', async () => {
    const { dispatcher, client, events } = buildDispatcher();
    const pending = buildPending();
    await events.save(pending);

    const result = await dispatcher.dispatchOnce();

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(client.posts).toEqual([
      {
        url: WEBHOOK_URL,
        payload: { ...PAYLOAD },
        // Sin `fraudConfig` cableado no hay secreto que resolver: EVT-003 no
        // cambia el comportamiento de un montaje que no lo pide.
        secret: null,
      },
    ]);
    const saved = await events.findById(pending.id);
    expect(saved?.status).toBe('SENT');
    expect(saved?.responseStatus).toBe(200);
    expect(saved?.attempts).toBe(1);
    expect(saved?.lastAttemptAt).toBe(T0);
  });

  it('keeps PENDING and stores response_status on non-2xx, then retries after backoff', async () => {
    const clock = new ControllableClock(T0);
    const client = new FakeOutgoingWebhookClient();
    client.nextResult = { statusCode: 503, ok: false };
    const { dispatcher, events } = buildDispatcher({ clock, client });
    const pending = buildPending();
    await events.save(pending);

    await dispatcher.dispatchOnce();

    let saved = await events.findById(pending.id);
    expect(saved?.status).toBe('PENDING');
    expect(saved?.attempts).toBe(1);
    expect(saved?.responseStatus).toBe(503);
    expect(saved?.lastAttemptAt).toBe(T0);

    // attempts=1 → claimPending waits BACKOFF[1]=2s
    clock.advanceBySeconds(1);
    client.nextResult = { statusCode: 200, ok: true };
    let result = await dispatcher.dispatchOnce();
    expect(result.processed).toBe(0);
    saved = await events.findById(pending.id);
    expect(saved?.status).toBe('PENDING');
    expect(saved?.attempts).toBe(1);

    clock.advanceBySeconds(1); // total +2s from last attempt
    result = await dispatcher.dispatchOnce();
    expect(result.sent).toBe(1);
    saved = await events.findById(pending.id);
    expect(saved?.status).toBe('SENT');
    expect(saved?.responseStatus).toBe(200);
    expect(saved?.attempts).toBe(2);
  });

  it('marks FAILED after the 5th failed attempt and does not claim again', async () => {
    const clock = new ControllableClock(T0);
    const client = new FakeOutgoingWebhookClient();
    client.nextResult = { statusCode: 500, ok: false };
    const { dispatcher, events } = buildDispatcher({ clock, client });
    const pending = buildPending();
    await events.save(pending);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await dispatcher.dispatchOnce();
      expect(result.processed).toBe(1);
      if (attempt < 4) {
        expect(result.failed).toBe(0);
        const saved = await events.findById(pending.id);
        expect(saved?.status).toBe('PENDING');
        expect(saved?.attempts).toBe(attempt + 1);
        clock.advanceBySeconds(BACKOFF_AFTER_ATTEMPTS[attempt]!);
      } else {
        expect(result.failed).toBe(1);
      }
    }

    const failed = await events.findById(pending.id);
    expect(failed?.status).toBe('FAILED');
    expect(failed?.attempts).toBe(5);
    expect(failed?.responseStatus).toBe(500);

    clock.advanceBySeconds(60);
    const after = await dispatcher.dispatchOnce();
    expect(after.processed).toBe(0);
    expect(client.posts).toHaveLength(5);
  });

  it('treats client throws as a failed attempt with response_status 0', async () => {
    const client = new FakeOutgoingWebhookClient();
    client.nextError = new Error('ECONNRESET');
    const { dispatcher, events } = buildDispatcher({ client });
    const pending = buildPending();
    await events.save(pending);

    await dispatcher.dispatchOnce();

    const saved = await events.findById(pending.id);
    expect(saved?.status).toBe('PENDING');
    expect(saved?.attempts).toBe(1);
    expect(saved?.responseStatus).toBe(0);
  });

  it('claims only events with attempts < 5 that are due', async () => {
    const clock = new ControllableClock(fromDate(new Date('2026-01-01T00:00:03.000Z')));
    const events = new InMemoryCustomerOutgoingEventRepository();
    const due = buildPending({ id: createCustomerOutgoingEventId(oid('outbox-due')) });
    const waiting = buildPending({
      id: createCustomerOutgoingEventId(oid('outbox-wait')),
      enforcementActionId: createEnforcementActionId(oid('action-2')),
    }).recordFailure({
      responseStatus: 500,
      now: fromDate(new Date('2026-01-01T00:00:02.000Z')),
    });
    await events.save(due);
    await events.save(waiting);

    const client = new FakeOutgoingWebhookClient();
    const { dispatcher } = buildDispatcher({ clock, client, events });
    const result = await dispatcher.dispatchOnce();

    expect(result.processed).toBe(1);
    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]?.url).toBe(WEBHOOK_URL);
    expect((await events.findById(due.id))?.status).toBe('SENT');
    expect((await events.findById(waiting.id))?.status).toBe('PENDING');
    expect((await events.findById(waiting.id))?.attempts).toBe(1);
  });

  it('start() polls on the sleeper interval until stop()', async () => {
    const client = new FakeOutgoingWebhookClient();
    const events = new InMemoryCustomerOutgoingEventRepository();
    const pending = buildPending();
    await events.save(pending);

    const sleepGate: { release?: () => void } = {};
    const sleeps: number[] = [];
    const gatedSleeper = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      await new Promise<void>((resolve) => {
        sleepGate.release = resolve;
      });
    };

    const clock = new ControllableClock(T0);
    const dispatcher = createCustomerOutgoingEventDispatcher({
      outgoingEvents: events,
      webhookClient: client,
      clock,
      sleeper: gatedSleeper,
    });

    const handle = dispatcher.start(1000);

    // Wait until first dispatch finishes and the loop parks on sleeper
    const deadline = Date.now() + 2000;
    while (sleeps.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(sleeps).toEqual([1000]);
    expect((await events.findById(pending.id))?.status).toBe('SENT');

    handle.stop();
    sleepGate.release?.();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('CustomerOutgoingEventDispatcher — secreto de firma por inquilino (EVT-003)', () => {
  const SECRET = 'k'.repeat(48);

  function configFor(organizationId: string, secret: string | null) {
    return OrganizationFraudConfig.create({
      id: createOrganizationFraudConfigId(oid(`cfg-${organizationId}`)),
      organizationId,
      slaLowMinutes: 60,
      slaMediumMinutes: 60,
      slaHighMinutes: 60,
      slaCriticalMinutes: 60,
      riskThresholdLow: 10,
      riskThresholdMedium: 40,
      riskThresholdHigh: 70,
      riskThresholdCritical: 90,
      outboundWebhookUrl: WEBHOOK_URL,
      outboundWebhookSecret: secret,
      now: T0,
    });
  }

  it('pasa al cliente el secreto del inquilino del evento', async () => {
    const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
    await fraudConfig.upsert(configFor(oid('org-1'), SECRET));
    const events = new InMemoryCustomerOutgoingEventRepository();
    await events.save(buildPending());
    const { dispatcher, client } = buildDispatcher({ events, fraudConfig });

    await dispatcher.dispatchOnce();

    expect(client.posts).toHaveLength(1);
    expect(client.posts[0]?.secret).toBe(SECRET);
  });

  it('sin secreto configurado entrega sin firmar', async () => {
    const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
    await fraudConfig.upsert(configFor(oid('org-1'), null));
    const events = new InMemoryCustomerOutgoingEventRepository();
    await events.save(buildPending());
    const { dispatcher, client } = buildDispatcher({ events, fraudConfig });

    await dispatcher.dispatchOnce();

    expect(client.posts[0]?.secret).toBeNull();
  });

  /**
   * La razon de la cache: una tanda toca pocos inquilinos y muchos eventos.
   * Sin ella, entregar 50 sanciones del mismo inquilino son 50 lecturas de la
   * misma fila de configuracion.
   */
  it('lee la configuracion una vez por inquilino y no por evento', async () => {
    const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
    await fraudConfig.upsert(configFor(oid('org-1'), SECRET));
    let reads = 0;
    const counting = {
      ...fraudConfig,
      findByOrganization: async (organizationId: string) => {
        reads += 1;
        return fraudConfig.findByOrganization(organizationId);
      },
    } as unknown as InMemoryOrganizationFraudConfigRepository;

    const events = new InMemoryCustomerOutgoingEventRepository();
    await events.save(buildPending());
    await events.save(
      buildPending({ id: createCustomerOutgoingEventId(oid('outbox-dispatch-2')) }),
    );
    await events.save(
      buildPending({ id: createCustomerOutgoingEventId(oid('outbox-dispatch-3')) }),
    );
    const { dispatcher, client } = buildDispatcher({ events, fraudConfig: counting });

    await dispatcher.dispatchOnce();

    expect(client.posts).toHaveLength(3);
    expect(reads).toBe(1);
  });

  /**
   * Estas entregas levantan y aplican sanciones sobre clientes reales. Un fallo
   * al leer la configuracion no puede dejar una restriccion puesta de mas.
   */
  it('si la configuracion no se puede leer, entrega sin firmar en vez de no entregar', async () => {
    const broken = {
      findByOrganization: async () => {
        throw new Error('mongo caido');
      },
    } as unknown as InMemoryOrganizationFraudConfigRepository;
    const events = new InMemoryCustomerOutgoingEventRepository();
    await events.save(buildPending());
    const { dispatcher, client } = buildDispatcher({ events, fraudConfig: broken });

    const result = await dispatcher.dispatchOnce();

    expect(result.sent).toBe(1);
    expect(client.posts[0]?.secret).toBeNull();
  });
});
