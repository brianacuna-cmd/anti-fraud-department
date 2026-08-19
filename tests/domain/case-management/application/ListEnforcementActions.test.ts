import { oid } from '../../../support/oid.js';
import { createListEnforcementActionsUseCase } from '../../../../src/modules/case-management/application/ListEnforcementActions.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { fromDate, type Instant } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_ID = oid('case-1');

const AUDITOR = createAuthContext({ userId: oid('aud-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'AUDITOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

let seq = 0;
function buildAction(overrides: {
  organizationId?: string;
  actionType?: 'BLOCK' | 'RESTRICT' | 'SUSPEND' | 'DELETE' | 'REVIEW';
  targetType?: string;
  targetId?: string;
  createdAt?: Instant;
} = {}): EnforcementAction {
  seq += 1;
  const now =
    overrides.createdAt ??
    fromDate(new Date(new Date('2026-01-01T00:00:00.000Z').getTime() + seq * 60_000));
  return EnforcementAction.create({
    id: createEnforcementActionId(oid(`ea-${seq}`)),
    caseId: createCaseId(CASE_ID),
    organizationId: overrides.organizationId ?? ORG_1,
    analystDecisionId: createAnalystDecisionId(oid(`ad-${seq}`)),
    actionType: overrides.actionType ?? 'BLOCK',
    targetType: overrides.targetType ?? 'WALLET',
    targetId: overrides.targetId ?? 'w-1',
    createdBy: oid('an-1'),
    now,
  });
}

function build(seeds: EnforcementAction[] = []) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  for (const seed of seeds) void enforcementActions.save(seed);
  return {
    enforcementActions,
    listEnforcementActions: createListEnforcementActionsUseCase({ enforcementActions }),
  };
}

describe('createListEnforcementActionsUseCase', () => {
  it('returns tenant-scoped actions newest-first with a total', async () => {
    const older = buildAction({ createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')) });
    const newer = buildAction({ createdAt: fromDate(new Date('2026-02-01T00:00:00.000Z')) });
    const otherOrg = buildAction({ organizationId: ORG_2 });
    const h = build([older, newer, otherOrg]);

    const result = await h.listEnforcementActions({ auth: AUDITOR, limit: 20, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.items.map((a) => a.id)).toEqual([newer.id, older.id]);
  });

  it('filters by entity (targetType + targetId)', async () => {
    const wallet = buildAction({ targetType: 'WALLET', targetId: 'w-1' });
    const email = buildAction({ targetType: 'EMAIL', targetId: 'e-1' });
    const h = build([wallet, email]);

    const result = await h.listEnforcementActions({
      auth: AUDITOR,
      targetType: 'WALLET',
      targetId: 'w-1',
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(wallet.id);
  });

  it('filters by actionType', async () => {
    const h = build([buildAction({ actionType: 'BLOCK' }), buildAction({ actionType: 'SUSPEND' })]);
    const result = await h.listEnforcementActions({ auth: AUDITOR, actionType: 'SUSPEND', limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]?.actionType).toBe('SUSPEND');
  });

  it('paginates via limit/offset while reporting the full total', async () => {
    const h = build([buildAction(), buildAction(), buildAction()]);
    const result = await h.listEnforcementActions({ auth: AUDITOR, limit: 2, offset: 0 });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(2);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build([buildAction()]);
    await expect(
      h.listEnforcementActions({ auth: ANALYST, limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' } satisfies Partial<CaseManagementError>);
  });
});
