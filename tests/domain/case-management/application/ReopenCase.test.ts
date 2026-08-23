import { oid } from '../../../support/oid.js';
import { createReopenCaseUseCase } from '../../../../src/modules/case-management/application/ReopenCase.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const OLD_DUE = fromDate(new Date('2025-12-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = createCaseId(oid('case-reopen-1'));
const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ADMIN',
});
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const AUDITOR = createAuthContext({
  userId: oid('auditor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'AUDITOR',
});

const EXPECTED_DUE = fromDate(
  new Date(toDate(NOW).getTime() + 120 * 60_000),
);

function buildResolvedCase(overrides: { deletedAt?: typeof NOW | null } = {}): Case {
  const open = Case.create({
    id: CASE_ID,
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
  const resolved = open
    .transitionTo('IN_REVIEW', NOW)
    .transitionTo('RESOLVED', NOW)
    .withDueDate(OLD_DUE, NOW);

  if (overrides.deletedAt == null) {
    return resolved;
  }

  return Case.rehydrate({
    id: resolved.id,
    organizationId: resolved.organizationId,
    customerId: resolved.customerId,
    customerEmail: resolved.customerEmail,
    bridgeUserId: resolved.bridgeUserId,
    bridgeWallet: resolved.bridgeWallet,
    stripeCustomerId: resolved.stripeCustomerId,
    finturuReference: resolved.finturuReference,
    finturuCacheSnapshot: resolved.finturuCacheSnapshot,
    riskScore: resolved.riskScore,
    status: resolved.status,
    priority: resolved.priority,
    assignedTo: resolved.assignedTo,
    dueDate: resolved.dueDate,
    tags: resolved.tags,
    createdAt: resolved.createdAt,
    updatedAt: resolved.updatedAt,
    deletedAt: overrides.deletedAt,
  });
}

function seedFraudConfig(repo: InMemoryOrganizationFraudConfigRepository): void {
  repo.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
      organizationId: ORG_1,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: {},
      now: NOW,
    }),
  );
}

function buildUseCase(seed?: Case, withSla = true, withFraudConfig = true) {
  const cases = new InMemoryCaseRepository();
  if (seed !== undefined) {
    void cases.save(seed);
  }
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  if (withFraudConfig) seedFraudConfig(fraudConfig);

  if (seed !== undefined && withSla) {
    void slaTracking.save(
      CaseSlaTracking.create({
        id: generateCaseSlaTrackingId(),
        caseId: seed.id,
        dueDate: OLD_DUE,
        now: NOW,
      }).advanceTo('WARNING', NOW).advanceTo('BREACHED', NOW),
    );
  }

  const reopenCase = createReopenCaseUseCase({
    cases,
    slaTracking,
    fraudConfig,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    generateCaseSlaTrackingId,
  });

  return { reopenCase, cases, timelineRecorder, auditRecorder, slaTracking, fraudConfig };
}

describe('createReopenCaseUseCase (role-gated reopen + SLA reset)', () => {
  it('reopens a RESOLVED case to OPEN, resets SLA/dueDate, and records CASE_REOPENED + REOPEN_CASE', async () => {
    const { reopenCase, cases, timelineRecorder, auditRecorder, slaTracking } = buildUseCase(
      buildResolvedCase(),
    );

    const result = await reopenCase({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      targetStatus: 'OPEN',
      justification: 'Customer provided new evidence',
    });

    expect(result.status).toBe('OPEN');
    expect(result.dueDate).toEqual(EXPECTED_DUE);
    expect(cases.all()[0]?.status).toBe('OPEN');
    expect(cases.all()[0]?.dueDate).toEqual(EXPECTED_DUE);

    const tracking = slaTracking.all()[0];
    expect(tracking).toBeDefined();
    expect(tracking?.status).toBe('ON_TRACK');
    expect(tracking?.dueDate).toEqual(EXPECTED_DUE);
    expect(tracking?.notifiedStatuses.size).toBe(0);

    const events = timelineRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('CASE_REOPENED');
    expect(events[0]?.previousValue).toBe('RESOLVED');
    expect(events[0]?.newValue).toBe('OPEN');
    expect(events[0]?.createdBy).toBe(oid('supervisor-1'));

    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('REOPEN_CASE');
    expect(audits[0]?.resource).toBe('case');
    expect(audits[0]?.detail).toMatchObject({
      targetStatus: 'OPEN',
      justification: 'Customer provided new evidence',
      previousStatus: 'RESOLVED',
    });
  });

  it('allows SUPERVISOR to reopen an ARCHIVED case to IN_REVIEW', async () => {
    const archived = buildResolvedCase().transitionTo('ARCHIVED', NOW);
    const { reopenCase } = buildUseCase(archived);

    const result = await reopenCase({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      targetStatus: 'IN_REVIEW',
      justification: 'Supervisor requested reopen',
    });

    expect(result.status).toBe('IN_REVIEW');
    expect(result.dueDate).toEqual(EXPECTED_DUE);
  });

  /**
   * Reabrir revive un expediente cerrado: es un acto de autoridad operativa,
   * no de gobierno. ADMIN lo ve, no lo hace (SoD).
   */
  it('rejects ADMIN as read-only', async () => {
    const { reopenCase } = buildUseCase(buildResolvedCase());

    await expect(
      reopenCase({
        auth: ADMIN,
        caseId: CASE_ID,
        targetStatus: 'IN_REVIEW',
        justification: 'Admin should not be able to do this',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects missing justification with INVARIANT_VIOLATION', async () => {
    const { reopenCase, timelineRecorder, auditRecorder } = buildUseCase(buildResolvedCase());

    await expect(
      reopenCase({
        auth: SUPERVISOR,
        caseId: CASE_ID,
        targetStatus: 'OPEN',
        justification: '   ',
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const { reopenCase } = buildUseCase(buildResolvedCase());

    await expect(
      reopenCase({
        auth: ANALYST,
        caseId: CASE_ID,
        targetStatus: 'OPEN',
        justification: 'Should not work',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects AUDITOR with FORBIDDEN_ROLE', async () => {
    const { reopenCase } = buildUseCase(buildResolvedCase());

    await expect(
      reopenCase({
        auth: AUDITOR,
        caseId: CASE_ID,
        targetStatus: 'OPEN',
        justification: 'Should not work',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('returns CASE_NOT_FOUND when the case is soft-deleted', async () => {
    const { reopenCase, timelineRecorder, auditRecorder } = buildUseCase(
      buildResolvedCase({ deletedAt: NOW }),
    );

    await expect(
      reopenCase({
        auth: SUPERVISOR,
        caseId: CASE_ID,
        targetStatus: 'OPEN',
        justification: 'Still deleted',
      }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('creates SLA tracking when none exists yet and still resets dueDate', async () => {
    const { reopenCase, slaTracking } = buildUseCase(buildResolvedCase(), false);

    const result = await reopenCase({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      targetStatus: 'OPEN',
      justification: 'No prior SLA row',
    });

    expect(result.dueDate).toEqual(EXPECTED_DUE);
    expect(slaTracking.all()).toHaveLength(1);
    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
    expect(slaTracking.all()[0]?.dueDate).toEqual(EXPECTED_DUE);
  });
});

/*
 * Esta prueba existe por un fallo real: `ReopenCase` lanzaba
 * ORGANIZATION_FRAUD_CONFIG_NOT_FOUND cuando el inquilino no tenia
 * configuracion, mientras que ABRIR el mismo expediente caia a la ventana por
 * defecto sin quejarse. Un inquilino recien creado podia abrir casos y
 * cerrarlos, pero no reabrirlos.
 *
 * Dos caminos que calculan el mismo plazo no pueden discrepar sobre si la
 * configuracion es obligatoria, y no habia ninguna prueba que lo sujetara.
 */
describe('createReopenCaseUseCase sin configuracion antifraude', () => {
  it('reabre con la ventana por defecto en vez de fallar', async () => {
    const seed = buildResolvedCase();
    const h = buildUseCase(seed, true, false);

    const reopened = await h.reopenCase({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      targetStatus: 'OPEN',
      justification: 'Aparecio informacion nueva.',
    });

    expect(reopened.status).toBe('OPEN');
    // Lo que importa no es el numero exacto sino que EXISTA un plazo: un
    // expediente reabierto sin fecha limite es invisible al barrido de SLA.
    expect(reopened.dueDate).not.toBeNull();
    expect(await h.slaTracking.findByCaseId(CASE_ID)).not.toBeNull();
  });
});
