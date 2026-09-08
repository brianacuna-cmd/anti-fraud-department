import { ObjectId } from 'mongodb';
import { ScheduledJob } from '../../../../src/shared/scheduled-jobs/ScheduledJob.js';
import { createScheduledJobId } from '../../../../src/shared/scheduled-jobs/ScheduledJobId.js';
import { toDocument, toDomain } from '../../../../src/shared/scheduled-jobs/mongo/ScheduledJobDocumentMapper.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-08-28T15:00:00.000Z'));
const LAST_RUN = fromDate(new Date('2026-08-28T15:00:30.000Z'));
const NEXT_RUN = fromDate(new Date('2026-08-28T15:01:30.000Z'));

const SPANISH_KEYS = [
  'nombre',
  'descripcion',
  'ultima_ejecucion',
  'proximo_ejecutar',
  'resultado_ultimo',
  'error_mensaje',
] as const;

function freshJob(): ScheduledJob {
  return ScheduledJob.create({
    id: createScheduledJobId(oid('job-sla')),
    organizationId: null,
    name: 'sla_sweep',
    description: 'Sweep SLA tracking rows',
    cronExpression: 'every 60s',
    now: NOW,
  }).recordRun({
    result: 'SUCCESS',
    lastError: null,
    nextRunAt: NEXT_RUN,
    now: LAST_RUN,
  });
}

describe('ScheduledJobDocumentMapper', () => {
  it('maps domain to English snake_case BSON keys with Instant as Date and null organization_id', () => {
    const document = toDocument(freshJob());

    expect(document).toEqual({
      _id: new ObjectId(oid('job-sla')),
      organization_id: null,
      name: 'sla_sweep',
      description: 'Sweep SLA tracking rows',
      cron_expression: 'every 60s',
      enabled: true,
      last_run_at: toDate(LAST_RUN),
      next_run_at: toDate(NEXT_RUN),
      last_result: 'SUCCESS',
      last_error: null,
      created_at: toDate(NOW),
    });
    expect(document.last_run_at).toBeInstanceOf(Date);
    expect(document.next_run_at).toBeInstanceOf(Date);
    expect(document.created_at).toBeInstanceOf(Date);

    for (const key of SPANISH_KEYS) {
      expect(document).not.toHaveProperty(key);
    }
  });

  it('maps organization_id ObjectId when the job is tenant-scoped', () => {
    const job = ScheduledJob.create({
      id: createScheduledJobId(oid('job-org')),
      organizationId: oid('org-1'),
      name: 'outbox_publish',
      description: 'Publish outbox events',
      cronExpression: 'every 5s',
      enabled: false,
      now: NOW,
    });

    const document = toDocument(job);

    expect(document.organization_id).toEqual(new ObjectId(oid('org-1')));
    expect(document.enabled).toBe(false);
    expect(document.last_result).toBeNull();
    expect(document.last_run_at).toBeNull();
    expect(document.next_run_at).toBeNull();
  });

  it('round-trips Instant fields and null organization_id (FK organizations, never admin_organizations)', () => {
    const job = freshJob();
    const roundTripped = toDomain(toDocument(job));

    expect(roundTripped.toProps()).toEqual(job.toProps());
    expect(roundTripped.organizationId).toBeNull();
    expect(roundTripped.lastRunAt).toBe(LAST_RUN);
    expect(roundTripped.nextRunAt).toBe(NEXT_RUN);
    expect(roundTripped.createdAt).toBe(NOW);
  });

  it('coerces omitted seed-only tick fields to null', () => {
    const seedOnly = {
      _id: new ObjectId(oid('job-seed')),
      organization_id: null,
      name: 'directory_sync',
      description: 'Sync directory',
      cron_expression: 'every 15m',
      enabled: false,
      created_at: toDate(NOW),
    };

    const domain = toDomain(seedOnly);

    expect(domain.lastRunAt).toBeNull();
    expect(domain.nextRunAt).toBeNull();
    expect(domain.lastResult).toBeNull();
    expect(domain.lastError).toBeNull();
    expect(domain.name).toBe('directory_sync');
    expect(domain.enabled).toBe(false);
  });

  it('reads incoming ERROR last_result as FAILED', () => {
    const document = toDocument(freshJob());
    const withError = { ...document, last_result: 'ERROR', last_error: 'legacy' };

    const domain = toDomain(withError);

    expect(domain.lastResult).toBe('FAILED');
    expect(domain.lastError).toBe('legacy');
  });
});
