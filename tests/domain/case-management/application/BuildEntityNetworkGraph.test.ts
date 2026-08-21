import { oid } from '../../../support/oid.js';
import {
  createBuildEntityNetworkGraphUseCase,
  DEFAULT_GRAPH_DEPTH,
  MAX_GRAPH_DEPTH,
} from '../../../../src/modules/case-management/application/BuildEntityNetworkGraph.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const INVESTIGATION_ID = createInvestigationId(oid('inv-1'));
const ROOT_CASE_ID = createCaseId(oid('case-root'));

const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

let seq = 0;
function buildCase(overrides: {
  organizationId?: string;
  customerId?: string;
  customerEmail?: string | null;
  bridgeWallet?: string | null;
  bridgeUserId?: string | null;
}): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-${seq}`)),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: overrides.customerId ?? `customer-${seq}`,
    customerEmail: overrides.customerEmail ?? null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    bridgeUserId: overrides.bridgeUserId ?? null,
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
}

function buildInvestigation(
  overrides: { organizationId?: string; subjectType?: 'WALLET' | 'EMAIL' | 'CUSTOMER'; subjectId?: string } = {},
): Investigation {
  return Investigation.open({
    id: INVESTIGATION_ID,
    caseId: ROOT_CASE_ID,
    organizationId: overrides.organizationId ?? ORG_1,
    subjectType: overrides.subjectType ?? 'WALLET',
    subjectId: overrides.subjectId ?? '0xroot',
    openedBy: oid('analyst-1'),
    now: NOW,
  });
}

function setup() {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const buildGraph = createBuildEntityNetworkGraphUseCase({ cases, investigations });
  return { cases, investigations, buildGraph };
}

describe('BuildEntityNetworkGraph (INV-013)', () => {
  it('404 cuando la investigación no existe', async () => {
    const { buildGraph } = setup();

    await expect(
      buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('403 cuando la investigación es de otra organización', async () => {
    const { investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ organizationId: ORG_2 }));

    // No se degrada a 404: el actor no puede distinguir "no existe" de "no es
    // tuya", pero el registro de auditoría sí tiene que poder.
    await expect(buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID })).rejects.toThrow(
      /does not belong/,
    );
  });

  it('rechaza una profundidad fuera de rango', async () => {
    const { investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation());

    await expect(
      buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID, maxDepth: 0 }),
    ).rejects.toThrow(CaseManagementError);
    await expect(
      buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID, maxDepth: MAX_GRAPH_DEPTH + 1 }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('devuelve solo la raíz cuando ningún expediente la cita', async () => {
    const { investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectId: '0xroot' }));

    const graph = await buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID });

    expect(graph.rootId).toBe('WALLET:0xroot');
    expect(graph.nodes).toHaveLength(1);
    expect(graph.truncated).toBe(false);
  });

  it('encadena la red a dos saltos: wallet → caso → email → caso', async () => {
    const { cases, investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectType: 'WALLET', subjectId: '0xroot' }));

    const first = buildCase({ customerId: 'cus-a', bridgeWallet: '0xroot', customerEmail: 'mula@x.com' });
    const second = buildCase({ customerId: 'cus-b', customerEmail: 'mula@x.com' });
    // Sin relación con la red: comparte cero identificadores.
    const unrelated = buildCase({ customerId: 'cus-z', bridgeWallet: '0xotra' });
    await cases.save(first);
    await cases.save(second);
    await cases.save(unrelated);

    const graph = await buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID });

    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toContain(`CASE:${first.id}`);
    // El segundo caso solo entra por el email compartido, a la ronda siguiente.
    expect(ids).toContain(`CASE:${second.id}`);
    expect(ids).toContain('EMAIL:mula@x.com');
    expect(ids).not.toContain(`CASE:${unrelated.id}`);
  });

  it('no cruza inquilinos aunque el identificador sea idéntico', async () => {
    const { cases, investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectId: '0xroot' }));

    const mine = buildCase({ organizationId: ORG_1, bridgeWallet: '0xroot' });
    const theirs = buildCase({ organizationId: ORG_2, bridgeWallet: '0xroot' });
    await cases.save(mine);
    await cases.save(theirs);

    const graph = await buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID });

    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toContain(`CASE:${mine.id}`);
    // Misma wallet, otro inquilino: incluirlo revelaría que ese expediente existe.
    expect(ids).not.toContain(`CASE:${theirs.id}`);
  });

  it('para de expandir al agotar la red, sin gastar las rondas restantes', async () => {
    const { cases, investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectId: '0xroot' }));
    await cases.save(buildCase({ customerId: 'cus-a', bridgeWallet: '0xroot' }));

    const spy = jest.spyOn(cases, 'findByEntityIdentifiers');
    const graph = await buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID });

    // Ronda 1 encuentra el caso; ronda 2 explora `cus-a` y no halla nada más,
    // así que la 3 (DEFAULT_GRAPH_DEPTH) sobra y no debe consultarse.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(DEFAULT_GRAPH_DEPTH).toBe(3);
    expect(graph.truncated).toBe(false);
  });

  it('marca truncated cuando la profundidad se agota con frente pendiente', async () => {
    const { cases, investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectId: '0xroot' }));
    await cases.save(buildCase({ customerId: 'cus-a', bridgeWallet: '0xroot' }));

    const graph = await buildGraph({
      auth: ANALYST,
      investigationId: INVESTIGATION_ID,
      maxDepth: 1,
    });

    expect(graph.depthReached).toBe(1);
    expect(graph.truncated).toBe(true);
  });

  it('ignora expedientes borrados lógicamente', async () => {
    const { cases, investigations, buildGraph } = setup();
    await investigations.save(buildInvestigation({ subjectId: '0xroot' }));

    const live = buildCase({ bridgeWallet: '0xroot' });
    const deleted = Case.rehydrate({
      ...toProps(buildCase({ bridgeWallet: '0xroot' })),
      deletedAt: NOW,
    });
    await cases.save(live);
    await cases.save(deleted);

    const graph = await buildGraph({ auth: ANALYST, investigationId: INVESTIGATION_ID });

    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toContain(`CASE:${live.id}`);
    expect(ids).not.toContain(`CASE:${deleted.id}`);
  });
});

function toProps(kase: Case) {
  return {
    id: kase.id,
    organizationId: kase.organizationId,
    customerId: kase.customerId,
    customerEmail: kase.customerEmail,
    bridgeUserId: kase.bridgeUserId,
    bridgeWallet: kase.bridgeWallet,
    stripeCustomerId: kase.stripeCustomerId,
    finturuReference: kase.finturuReference,
    finturuCacheSnapshot: kase.finturuCacheSnapshot,
    riskScore: kase.riskScore,
    status: kase.status,
    priority: kase.priority,
    assignedTo: kase.assignedTo,
    dueDate: kase.dueDate,
    tags: kase.tags,
    createdAt: kase.createdAt,
    updatedAt: kase.updatedAt,
    deletedAt: kase.deletedAt,
  };
}
