import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import {
  createGetFraudMetricsUseCase,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
} from '../../../../src/modules/case-management/application/GetFraudMetrics.js';
import type {
  FraudMetricsQuery,
  FraudMetricsReader,
  FraudMetricsSnapshot,
} from '../../../../src/modules/case-management/domain/ports/FraudMetricsReader.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-20T12:00:00.000Z'));
const ORG = oid('org-1');

const ANALYST_ID = oid('analyst-1');
const GHOST_ID = oid('analyst-gone');

class RecordingMetricsReader implements FraudMetricsReader {
  readonly queries: FraudMetricsQuery[] = [];

  constructor(private readonly workload: FraudMetricsSnapshot['workload'] = []) {}

  async snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot> {
    this.queries.push(query);
    return {
      generatedAt: query.now,
      windowDays: query.windowDays,
      cases: { total: 0, byStatus: {}, byPriority: {}, byRiskBucket: [], overdue: 0, unassigned: 0 },
      flow: [],
      enforcement: { byStatus: {}, byActionType: {}, pendingApproval: 0 },
      workload: this.workload,
      resolution: { resolvedInWindow: 0, averageHoursToResolve: null },
    };
  }
}

function buildUseCase(workload: FraudMetricsSnapshot['workload'] = []) {
  const metrics = new RecordingMetricsReader(workload);
  const assignees = new InMemoryAssigneeDirectory();
  assignees.nameFor(ORG, createAssignedTo('USER', ANALYST_ID), 'Ada Lovelace');
  return {
    metrics,
    assignees,
    getFraudMetrics: createGetFraudMetricsUseCase({
      metrics,
      clock: new FixedClock(NOW),
      assignees,
    }),
  };
}

function actor(roleId: string | null, actorType: 'USER' | 'ORGANIZATION' = 'USER') {
  return createAuthContext({ userId: oid('user-1'), organizationId: ORG, actorType, roleId });
}

describe('createGetFraudMetricsUseCase', () => {
  it('tenant-scopes the query and defaults the window', async () => {
    const { getFraudMetrics, metrics } = buildUseCase();

    const snapshot = await getFraudMetrics({ auth: actor('ADMIN') });

    expect(metrics.queries).toEqual([
      { organizationId: ORG, windowDays: DEFAULT_WINDOW_DAYS, now: NOW },
    ]);
    expect(snapshot.generatedAt).toBe(NOW);
  });

  /**
   * El panel es justo lo que el plano de gobierno SI puede hacer, ahora que
   * no opera sobre expedientes.
   */
  it.each([
    ['ADMIN', () => actor('ADMIN')],
    ['AUDITOR', () => actor('AUDITOR')],
    ['SUPERVISOR', () => actor('SUPERVISOR')],
    ['the ORGANIZATION actor', () => actor(null, 'ORGANIZATION')],
  ])('lets %s read it', async (_label, auth) => {
    const { getFraudMetrics } = buildUseCase();

    await expect(getFraudMetrics({ auth: auth() })).resolves.toBeDefined();
  });

  it('rejects ANALYST: the analyst works a queue, not the department metric', async () => {
    const { getFraudMetrics, metrics } = buildUseCase();

    await expect(getFraudMetrics({ auth: actor('ANALYST') })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    expect(metrics.queries).toHaveLength(0);
  });

  /**
   * PLATFORM_ADMIN no tiene inquilino, asi que no hay panel que ensenarle.
   * Cae en la guarda de rol antes que en la de inquilino —llega sin
   * `roleId`— y ese orden da igual: lo importante es que no se consulte nada.
   */
  it('rejects PLATFORM_ADMIN before touching the reader', async () => {
    const { getFraudMetrics, metrics } = buildUseCase();
    const platformAdmin = createAuthContext({
      userId: oid('admin-1'),
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
    });

    await expect(getFraudMetrics({ auth: platformAdmin })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    expect(metrics.queries).toHaveLength(0);
  });

  it.each([0, -1, 1.5, MAX_WINDOW_DAYS + 1])(
    'rejects windowDays=%p with INVARIANT_VIOLATION',
    async (windowDays) => {
      const { getFraudMetrics, metrics } = buildUseCase();

      await expect(getFraudMetrics({ auth: actor('ADMIN'), windowDays })).rejects.toMatchObject({
        code: 'INVARIANT_VIOLATION',
      });
      expect(metrics.queries).toHaveLength(0);
    },
  );

  it.each([1, MAX_WINDOW_DAYS])('accepts the boundary windowDays=%p', async (windowDays) => {
    const { getFraudMetrics, metrics } = buildUseCase();

    await getFraudMetrics({ auth: actor('ADMIN'), windowDays });

    expect(metrics.queries[0]?.windowDays).toBe(windowDays);
  });

  /**
   * Sin esto la barra de cada responsable se rotula con un ObjectId en
   * hexadecimal, que no dice quién tiene los expedientes encima.
   */
  it('names the assignees, and leaves an unresolved one null instead of inventing a name', async () => {
    const { getFraudMetrics } = buildUseCase([
      { assigneeId: ANALYST_ID, assigneeType: 'USER', open: 5, overdue: 1 },
      { assigneeId: GHOST_ID, assigneeType: 'USER', open: 2, overdue: 0 },
    ]);

    const snapshot = await getFraudMetrics({ auth: actor('ADMIN') });

    expect(snapshot.workload).toEqual([
      { assigneeId: ANALYST_ID, assigneeType: 'USER', assigneeName: 'Ada Lovelace', open: 5, overdue: 1 },
      { assigneeId: GHOST_ID, assigneeType: 'USER', assigneeName: null, open: 2, overdue: 0 },
    ]);
  });

  /** El panel entero no puede caerse porque el directorio de identidad falle. */
  it('falls back to unnamed workload when the directory throws', async () => {
    const { getFraudMetrics, assignees } = buildUseCase([
      { assigneeId: ANALYST_ID, assigneeType: 'USER', open: 5, overdue: 1 },
    ]);
    jest.spyOn(assignees, 'displayNames').mockRejectedValue(new Error('identity is down'));

    const snapshot = await getFraudMetrics({ auth: actor('ADMIN') });

    expect(snapshot.workload).toEqual([
      { assigneeId: ANALYST_ID, assigneeType: 'USER', open: 5, overdue: 1 },
    ]);
  });
});
