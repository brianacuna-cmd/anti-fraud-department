import { oid } from '../../../support/oid.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { metricsRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/metricsRouter.js';
import {
  createGetFraudMetricsUseCase,
  DEFAULT_WINDOW_DAYS,
} from '../../../../src/modules/case-management/application/GetFraudMetrics.js';
import type {
  FraudMetricsQuery,
  FraudMetricsReader,
  FraudMetricsSnapshot,
} from '../../../../src/modules/case-management/domain/ports/FraudMetricsReader.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';

const NOW = fromDate(new Date('2026-08-20T12:00:00.000Z'));
const ORG = oid('org-1');

class RecordingMetricsReader implements FraudMetricsReader {
  readonly queries: FraudMetricsQuery[] = [];

  async snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot> {
    this.queries.push(query);
    return {
      generatedAt: query.now,
      windowDays: query.windowDays,
      cases: {
        total: 1,
        byStatus: { OPEN: 1 },
        byPriority: { HIGH: 1 },
        byRiskBucket: [{ label: 'Alto', from: 50, to: 74, count: 1 }],
        overdue: 0,
        unassigned: 1,
      },
      flow: [{ date: '2026-08-20', opened: 1, resolved: 0 }],
      enforcement: { byStatus: {}, byActionType: {}, pendingApproval: 0 },
      workload: [],
      resolution: { resolvedInWindow: 0, averageHoursToResolve: null },
    };
  }
}

function buildApp(actor: AuthContext) {
  const metrics = new RecordingMetricsReader();
  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actor);
    next();
  });
  api.use(
    metricsRouter({
      getFraudMetrics: createGetFraudMetricsUseCase({
        metrics,
        clock: { now: () => NOW },
        assignees: new InMemoryAssigneeDirectory(),
      }),
    }),
  );

  return {
    metrics,
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...caseManagementErrorStatus }),
    }),
  };
}

function user(roleId: string | null) {
  return createAuthContext({ userId: oid('user-1'), organizationId: ORG, actorType: 'USER', roleId });
}

describe('metricsRouter', () => {
  it('returns the snapshot for ADMIN and defaults the window', async () => {
    const { app, metrics } = buildApp(user('ADMIN'));

    const res = await request(app).get('/api/v1/metrics/overview');

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(DEFAULT_WINDOW_DAYS);
    expect(res.body.cases.byStatus).toEqual({ OPEN: 1 });
    expect(metrics.queries[0]?.windowDays).toBe(DEFAULT_WINDOW_DAYS);
  });

  /** `windowDays` viaja como cadena en el query string. */
  it('coerces windowDays from the query string', async () => {
    const { app, metrics } = buildApp(user('ADMIN'));

    const res = await request(app).get('/api/v1/metrics/overview?windowDays=7');

    expect(res.status).toBe(200);
    expect(metrics.queries[0]?.windowDays).toBe(7);
  });

  it('rejects a non-numeric windowDays with 400', async () => {
    const { app, metrics } = buildApp(user('ADMIN'));

    const res = await request(app).get('/api/v1/metrics/overview?windowDays=abc');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(metrics.queries).toHaveLength(0);
  });

  it('rejects an out-of-range windowDays with 400', async () => {
    const { app } = buildApp(user('ADMIN'));

    const res = await request(app).get('/api/v1/metrics/overview?windowDays=9999');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('serves the ORGANIZATION actor, which carries no roleId at all', async () => {
    const organization = createAuthContext({
      userId: ORG,
      organizationId: ORG,
      actorType: 'ORGANIZATION',
      roleId: null,
    });
    const { app } = buildApp(organization);

    const res = await request(app).get('/api/v1/metrics/overview');

    expect(res.status).toBe(200);
  });

  it('returns 403 for ANALYST', async () => {
    const { app, metrics } = buildApp(user('ANALYST'));

    const res = await request(app).get('/api/v1/metrics/overview');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    expect(metrics.queries).toHaveLength(0);
  });
});
