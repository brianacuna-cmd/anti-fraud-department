import { createImportPaymentActivitiesUseCase, MAX_IMPORT_ROWS } from '../../../../src/modules/risk-assessment/application/ImportPaymentActivities.js';
import { generatePaymentActivityId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/PaymentActivityId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { InMemoryPaymentActivityRepository } from '../../../helpers/risk-assessment/InMemoryPaymentActivityRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { ANCHOR } from '../../../helpers/risk-assessment/paymentActivityFixtures.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { oid } from '../../../support/oid.js';

const ORG = oid('org-1');
const SUPERVISOR = createAuthContext({ userId: oid('sup'), organizationId: ORG, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an'), organizationId: ORG, actorType: 'USER', roleId: 'ANALYST' });

const VALID = {
  provider: 'Stripe',
  customer_id: 'cus_1',
  kind: 'attempt',
  amount: '12.50',
  currency: 'usd',
  occurred_at: '2026-03-01T10:00:00Z',
  outcome: 'failed',
  provider_reference: 'ch_1',
  related_references: 'pi_1 | pi_1b',
  merchant_id: 'acct_9',
  decline_code: 'stolen_card',
  card_country: 'ng',
};

function build() {
  const activities = new InMemoryPaymentActivityRepository();
  const audit = new InMemoryRiskAssessmentAuditRecorder();
  const importActivities = createImportPaymentActivitiesUseCase({
    activities,
    auditRecorder: audit,
    clock: new FixedClock(ANCHOR),
    generatePaymentActivityId,
  });
  return { activities, audit, importActivities };
}

describe('createImportPaymentActivitiesUseCase', () => {
  it('loads valid rows as CSV_IMPORT history, normalizing and classifying the decline', async () => {
    const { activities, audit, importActivities } = build();

    const result = await importActivities({ auth: SUPERVISOR, rows: [VALID], fileName: 'stripe-marzo.csv' });

    expect(result).toEqual({ rowsRead: 1, inserted: 1, duplicates: 0, rejected: 0, errors: [] });
    expect(activities.all()[0]?.toProps()).toMatchObject({
      provider: 'stripe',
      kind: 'ATTEMPT',
      outcome: 'FAILED',
      amountCents: 1250,
      currency: 'USD',
      relatedReferences: ['pi_1', 'pi_1b'],
      merchantId: 'acct_9',
      declineCategory: 'FRAUD_SUSPECTED',
      cardCountry: 'NG',
      source: 'CSV_IMPORT',
      providerEventType: 'csv.attempt',
    });
    expect(audit.all()[0]).toMatchObject({
      action: 'IMPORT_PAYMENT_ACTIVITIES',
      detail: { fileName: 'stripe-marzo.csv', inserted: 1 },
    });
  });

  it('reports bad rows with their file line and still loads the rest', async () => {
    const { activities, importActivities } = build();

    const result = await importActivities({
      auth: SUPERVISOR,
      rows: [
        { ...VALID, amount: '1.234,50' },
        VALID,
        { ...VALID, customer_id: '' },
        { ...VALID, occurred_at: 'ayer' },
        { ...VALID, outcome: '' },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.rejected).toBe(4);
    expect(result.errors.map((e) => e.line)).toEqual([2, 4, 5, 6]);
    expect(result.errors[1]?.reason).toContain('customer_id');
    expect(activities.all()).toHaveLength(1);
  });

  it('is idempotent: re-importing the same file inserts nothing', async () => {
    const { importActivities } = build();
    await importActivities({ auth: SUPERVISOR, rows: [VALID, { ...VALID, amount: '3.00' }] });

    const again = await importActivities({ auth: SUPERVISOR, rows: [VALID, { ...VALID, amount: '3.00' }] });

    expect(again).toMatchObject({ inserted: 0, duplicates: 2, rejected: 0 });
  });

  it('is for supervisors, and refuses oversized files before touching anything', async () => {
    const { activities, importActivities } = build();

    await expect(importActivities({ auth: ANALYST, rows: [VALID] })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    await expect(
      importActivities({ auth: SUPERVISOR, rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => VALID) }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    expect(activities.all()).toHaveLength(0);
  });
});
