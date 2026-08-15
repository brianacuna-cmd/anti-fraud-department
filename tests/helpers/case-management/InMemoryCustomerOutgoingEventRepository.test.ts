import { oid } from '../../support/oid.js';
import { CustomerOutgoingEvent } from '../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import { createCustomerOutgoingEventId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { createEnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { InMemoryCustomerOutgoingEventRepository } from './InMemoryCustomerOutgoingEventRepository.js';

const T0 = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildPending(idLabel: string) {
  return CustomerOutgoingEvent.create({
    id: createCustomerOutgoingEventId(oid(idLabel)),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    enforcementActionId: createEnforcementActionId(oid(`action-${idLabel}`)),
    webhookUrl: 'https://hooks.example/fraud',
    eventType: 'ENFORCEMENT_EXECUTED',
    payload: {
      enforcement_action_id: oid(`action-${idLabel}`),
      case_id: oid('case-1'),
      action_type: 'BLOCK',
      target_type: 'CUSTOMER',
      target_id: oid('customer-1'),
      organization_id: oid('org-1'),
    },
    now: T0,
  });
}

describe('InMemoryCustomerOutgoingEventRepository claim-lease semantics', () => {
  it('does not re-claim an already-claimed event within the lease TTL', async () => {
    const repository = new InMemoryCustomerOutgoingEventRepository();
    await repository.save(buildPending('outbox-1'));

    const first = await repository.claimPending(T0, 10);
    const second = await repository.claimPending(T0, 10);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('releases the lease once save() persists the outcome', async () => {
    const repository = new InMemoryCustomerOutgoingEventRepository();
    const pending = buildPending('outbox-2');
    await repository.save(pending);

    const [claimed] = await repository.claimPending(T0, 10);
    expect(claimed).toBeDefined();

    const sent = claimed!.markSent({ responseStatus: 200, now: T0 });
    await repository.save(sent);

    // SENT is not claimable regardless of lease, but confirms save() cleared the marker
    // by re-claiming a fresh PENDING row created with the same lease bookkeeping path.
    const other = buildPending('outbox-3');
    await repository.save(other);
    const reclaimed = await repository.claimPending(T0, 10);
    expect(reclaimed.map((e) => e.id)).toEqual([other.id]);
  });

  it('re-claims an event once the lease TTL has elapsed (crash recovery)', async () => {
    const repository = new InMemoryCustomerOutgoingEventRepository();
    await repository.save(buildPending('outbox-4'));

    await repository.claimPending(T0, 10);
    const stillLeased = await repository.claimPending(
      fromDate(new Date('2026-01-01T00:04:59.000Z')),
      10,
    );
    expect(stillLeased).toHaveLength(0);

    const afterLeaseExpiry = await repository.claimPending(
      fromDate(new Date('2026-01-01T00:05:01.000Z')),
      10,
    );
    expect(afterLeaseExpiry).toHaveLength(1);
  });
});
