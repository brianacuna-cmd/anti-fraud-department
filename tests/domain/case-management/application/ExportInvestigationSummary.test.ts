import { oid } from '../../../support/oid.js';
import { createExportInvestigationSummaryUseCase } from '../../../../src/modules/case-management/application/ExportInvestigationSummary.js';
import { createBuildEntityNetworkGraphUseCase } from '../../../../src/modules/case-management/application/BuildEntityNetworkGraph.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { AnalystDecision } from '../../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { CaseNote } from '../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const INV_ID = createInvestigationId(oid('inv-1'));
const ANALYST_ID = oid('analyst-1');
const ROOT_WALLET = '0xroot';

const ANALYST = createAuthContext({
  userId: ANALYST_ID,
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

let seq = 0;
function buildCase(overrides: {
  customerId?: string;
  bridgeWallet?: string | null;
  customerEmail?: string | null;
  riskScore?: number;
  organizationId?: string;
}): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-sum-${seq}`)),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: overrides.customerId ?? `customer-${seq}`,
    customerEmail: overrides.customerEmail ?? null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    riskScore: createRiskScore(overrides.riskScore ?? 50),
    priority: 'HIGH',
    now: NOW,
  });
}

function setup() {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const notes = new InMemoryCaseNoteRepository();
  const evidence = new InMemoryEvidenceRepository();

  const exportSummary = createExportInvestigationSummaryUseCase({
    cases,
    investigations,
    decisions,
    enforcementActions,
    notes,
    evidence,
    buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
    clock: new FixedClock(NOW),
  });

  return { cases, investigations, decisions, enforcementActions, notes, evidence, exportSummary };
}

async function seedInvestigation(
  investigations: InMemoryInvestigationRepository,
  organizationId = ORG_1,
) {
  await investigations.save(
    Investigation.open({
      id: INV_ID,
      caseId: createCaseId(oid('case-root')),
      organizationId,
      subjectType: 'WALLET',
      subjectId: ROOT_WALLET,
      openedBy: ANALYST_ID,
      now: NOW,
    }),
  );
}

describe('ExportInvestigationSummary (INV-014)', () => {
  it('404 cuando la investigación no existe', async () => {
    const { exportSummary } = setup();

    await expect(exportSummary({ auth: ANALYST, investigationId: INV_ID })).rejects.toThrow(
      CaseManagementError,
    );
  });

  it('403 cuando es de otro inquilino', async () => {
    const { investigations, exportSummary } = setup();
    await seedInvestigation(investigations, ORG_2);

    await expect(exportSummary({ auth: ANALYST, investigationId: INV_ID })).rejects.toThrow(
      /does not belong/,
    );
  });

  it('consolida los expedientes de la red con sus dictámenes y sanciones', async () => {
    const { cases, investigations, decisions, enforcementActions, exportSummary } = setup();
    await seedInvestigation(investigations);

    const kase = buildCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET, riskScore: 90 });
    await cases.save(kase);

    const decisionId = createAnalystDecisionId(oid('decision-1'));
    await decisions.save(
      AnalystDecision.create({
        id: decisionId,
        caseId: kase.id,
        organizationId: ORG_1,
        decision: 'FRAUD_CONFIRMED',
        confidence: 95,
        comment: 'confirmado',
        createdBy: ANALYST_ID,
        now: NOW,
      }),
    );
    await enforcementActions.save(
      EnforcementAction.create({
        id: createEnforcementActionId(oid('enf-1')),
        caseId: kase.id,
        organizationId: ORG_1,
        analystDecisionId: decisionId,
        actionType: 'BLOCK',
        targetType: 'WALLET',
        targetId: ROOT_WALLET,
        createdBy: ANALYST_ID,
        now: NOW,
      }),
    );

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });

    expect(summary.investigation.subjectId).toBe(ROOT_WALLET);
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0]!.caseId).toBe(kase.id);
    expect(summary.cases[0]!.decisions).toHaveLength(1);
    expect(summary.cases[0]!.enforcementActions[0]!.actionType).toBe('BLOCK');
    expect(summary.totals.confirmedFraudCases).toBe(1);
    expect(summary.totals.enforcementActions).toBe(1);
    expect(summary.totals.maxRiskScore).toBe(90);
    expect(summary.totals.casesByStatus).toEqual({ OPEN: 1 });
  });

  it('ordena los expedientes por riesgo descendente', async () => {
    const { cases, investigations, exportSummary } = setup();
    await seedInvestigation(investigations);

    const low = buildCase({ customerId: 'cus-low', bridgeWallet: ROOT_WALLET, riskScore: 20 });
    const high = buildCase({ customerId: 'cus-high', bridgeWallet: ROOT_WALLET, riskScore: 95 });
    await cases.save(low);
    await cases.save(high);

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });

    // An executive report is read top to bottom: the worst goes first.
    expect(summary.cases.map((kase) => kase.caseId)).toEqual([high.id, low.id]);
  });

  it('cuenta las entidades de la red por tipo', async () => {
    const { cases, investigations, exportSummary } = setup();
    await seedInvestigation(investigations);
    await cases.save(
      buildCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET, customerEmail: 'mula@x.com' }),
    );

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });

    expect(summary.network.entitiesByType.WALLET).toBe(1);
    expect(summary.network.entitiesByType.EMAIL).toBe(1);
    expect(summary.network.entitiesByType.CUSTOMER).toBe(1);
    expect(summary.network.totalEntities).toBe(3);
    expect(summary.network.totalCases).toBe(1);
  });

  it('propaga truncated: los totales son un mínimo, no un total', async () => {
    const { cases, investigations, exportSummary } = setup();
    await seedInvestigation(investigations);
    await cases.save(buildCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET }));

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID, maxDepth: 1 });

    expect(summary.network.truncated).toBe(true);
    expect(summary.network.depthReached).toBe(1);
  });

  it('devuelve un informe vacío pero válido cuando la red no tiene expedientes', async () => {
    const { investigations, exportSummary } = setup();
    await seedInvestigation(investigations);

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });

    expect(summary.cases).toEqual([]);
    expect(summary.totals).toEqual({
      totalCases: 0,
      linkedCases: 0,
      networkCases: 0,
      casesByStatus: {},
      confirmedFraudCases: 0,
      enforcementActions: 0,
      maxRiskScore: 0,
    });
    expect(summary.generatedAt).toBe(NOW);
  });
  /**
   * The hole PR #122 closed: INV-013 expansion only sees connections that
   * exist as a shared identifier. A hand-made link may have none — two cases
   * tied by modus operandi — and leaving them out of the report would lose
   * human work in silence.
   */
  it('incluye los expedientes vinculados a mano aunque no compartan ningún identificador', async () => {
    const { cases, investigations, exportSummary } = setup();

    const root = buildCase({ customerId: 'cus-root', bridgeWallet: ROOT_WALLET, riskScore: 40 });
    const unrelated = buildCase({ customerId: 'cus-sin-relacion', riskScore: 70 });
    await cases.save(root);
    await cases.save(unrelated);

    await investigations.save(
      Investigation.open({
        id: INV_ID,
        caseId: root.id,
        organizationId: ORG_1,
        subjectType: 'WALLET',
        subjectId: ROOT_WALLET,
        openedBy: ANALYST_ID,
        now: NOW,
      }).linkCases([unrelated.id], NOW),
    );

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });
    const byId = new Map(summary.cases.map((kase) => [kase.caseId, kase]));

    expect(byId.get(unrelated.id)?.origin).toBe('LINKED');
    expect(byId.get(unrelated.id)?.depth).toBe(0);
    expect(byId.get(root.id)?.origin).toBe('PRIMARY');
    // The network alone would not have seen it: it shares no customer, email, or wallet.
    expect(summary.network.totalCases).toBe(1);
    expect(summary.totals.totalCases).toBe(2);
    expect(summary.totals.linkedCases).toBe(2);
    expect(summary.totals.networkCases).toBe(0);
  });

  it('un expediente vinculado y además descubierto conserva el origen declarado', async () => {
    const { cases, investigations, exportSummary } = setup();

    const root = buildCase({ customerId: 'cus-root', bridgeWallet: ROOT_WALLET });
    const both = buildCase({ customerId: 'cus-both', bridgeWallet: ROOT_WALLET, riskScore: 80 });
    await cases.save(root);
    await cases.save(both);

    await investigations.save(
      Investigation.open({
        id: INV_ID,
        caseId: root.id,
        organizationId: ORG_1,
        subjectType: 'WALLET',
        subjectId: ROOT_WALLET,
        openedBy: ANALYST_ID,
        now: NOW,
      }).linkCases([both.id], NOW),
    );

    const summary = await exportSummary({ auth: ANALYST, investigationId: INV_ID });

    expect(summary.cases.filter((kase) => kase.caseId === both.id)).toHaveLength(1);
    expect(summary.cases.find((kase) => kase.caseId === both.id)?.origin).toBe('LINKED');
  });

  it('sin includeCaseDetail no arrastra notas ni evidencia; con él, sí', async () => {
    const { cases, investigations, notes, evidence, exportSummary } = setup();
    await seedInvestigation(investigations);

    const kase = buildCase({ customerId: 'cus-a', bridgeWallet: ROOT_WALLET });
    await cases.save(kase);
    await notes.save(
      CaseNote.create({
        id: createCaseNoteId(oid('note-1')),
        caseId: kase.id,
        organizationId: ORG_1,
        authorId: ANALYST_ID,
        body: 'la wallet recibe de tres cuentas nuevas',
        now: NOW,
      }),
    );
    await evidence.save(
      Evidence.register({
        id: createEvidenceId(oid('evi-1')),
        caseId: kase.id,
        investigationId: null,
        organizationId: ORG_1,
        filename: 'extracto.pdf',
        contentType: 'application/pdf',
        byteSize: 2048,
        sha256: 'a'.repeat(64),
        storageKey: 'evidence/extracto.pdf',
        timestamp: null,
        scanStatus: 'CLEAN',
        uploadedBy: ANALYST_ID,
        now: NOW,
      }),
    );

    const light = await exportSummary({ auth: ANALYST, investigationId: INV_ID });
    expect(light.cases[0]!.notes).toBeUndefined();
    expect(light.cases[0]!.evidence).toBeUndefined();

    const full = await exportSummary({
      auth: ANALYST,
      investigationId: INV_ID,
      includeCaseDetail: true,
    });
    expect(full.cases[0]!.notes?.[0]!.body).toBe('la wallet recibe de tres cuentas nuevas');
    expect(full.cases[0]!.evidence?.[0]!.filename).toBe('extracto.pdf');
    expect(full.cases[0]!.evidence?.[0]!.sha256).toBe('a'.repeat(64));
  });
});
