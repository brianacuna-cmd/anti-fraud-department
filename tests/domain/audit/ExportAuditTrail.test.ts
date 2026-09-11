import { generateKeyPairSync, verify as nodeVerify, createPublicKey } from 'node:crypto';
import { oid } from '../../support/oid.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { AuditLog } from '../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId, generateAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import type {
  AuditLogFilter,
  AuditLogPage,
  AuditLogPageQuery,
  AuditLogReader,
} from '../../../src/modules/audit/domain/ports/AuditLogQuery.js';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/ports/AuditLogRepository.js';
import { createExportAuditTrailUseCase } from '../../../src/modules/audit/application/ExportAuditTrail.js';
import { Ed25519TrailSigner } from '../../../src/modules/audit/infrastructure/adapters/outbound/crypto/Ed25519TrailSigner.js';
import { FixedClock } from '../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-10-05T12:00:00.000Z'));
const ORG_1 = oid('org-1');

const AUDITOR = createAuthContext({
  userId: oid('aud-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'AUDITOR',
});
const ANALYST = createAuthContext({
  userId: oid('an-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});

function log(action: string, detail: Record<string, unknown> = {}): AuditLog {
  return AuditLog.create({
    id: createAuditLogId(oid(action)),
    organizationId: ORG_1,
    actorType: 'USER',
    actorId: oid('sup-1'),
    action,
    resource: 'case',
    resourceId: oid('case-1'),
    detail,
    ipAddress: '10.0.0.7',
    createdAt: NOW,
  });
}

class FakeReader implements AuditLogReader {
  constructor(private readonly rows: AuditLog[]) {}
  async page(_q: AuditLogPageQuery): Promise<AuditLogPage> {
    return { items: this.rows, total: this.rows.length };
  }
  async *stream(_f: AuditLogFilter): AsyncIterable<AuditLog> {
    for (const row of this.rows) yield row;
  }
}

class SpyRepository implements AuditLogRepository {
  readonly saved: AuditLog[] = [];
  async save(auditLog: AuditLog): Promise<void> {
    this.saved.push(auditLog);
  }
}

function build(rows: AuditLog[], privateKeyPem?: string) {
  const repository = new SpyRepository();
  const exportAuditTrail = createExportAuditTrailUseCase({
    reader: new FakeReader(rows),
    repository,
    signer: new Ed25519TrailSigner(privateKeyPem),
    clock: new FixedClock(NOW),
    generateAuditLogId,
  });
  return { exportAuditTrail, repository };
}

function ed25519Pem(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Lector CSV mínimo según RFC 4180: respeta comillas y comillas dobladas. */
function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === '"' && quoted && row[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  cells.push(current);
  return cells;
}

describe('createExportAuditTrailUseCase', () => {
  it('la firma verifica de verdad contra la clave pública que devuelve', async () => {
    const { exportAuditTrail } = build([log('RESOLVE_CASE')], ed25519Pem());

    const trail = await exportAuditTrail({ auth: AUDITOR, format: 'csv' });

    // Esto es lo que hará el auditor: verificar por su cuenta, sin pedirnos
    // nada. Si esto falla, la firma no vale para nada.
    const ok = nodeVerify(
      null,
      trail.body,
      createPublicKey(trail.signature.publicKeyPem),
      Buffer.from(trail.signature.signature, 'base64'),
    );
    expect(ok).toBe(true);
    expect(trail.signature.algorithm).toBe('Ed25519');
  });

  it('un byte distinto invalida la firma', async () => {
    const { exportAuditTrail } = build([log('RESOLVE_CASE')], ed25519Pem());
    const trail = await exportAuditTrail({ auth: AUDITOR, format: 'csv' });

    const manipulado = Buffer.from(trail.body);
    manipulado[manipulado.length - 2] ^= 0x01;

    expect(
      nodeVerify(
        null,
        manipulado,
        createPublicKey(trail.signature.publicKeyPem),
        Buffer.from(trail.signature.signature, 'base64'),
      ),
    ).toBe(false);
  });

  it('SIN CLAVE no devuelve un fichero sin firmar: falla', async () => {
    const { exportAuditTrail, repository } = build([log('RESOLVE_CASE')], undefined);

    // Degradar en silencio sería prometer una garantía que no se está dando:
    // un volcado sin firma es indistinguible de uno firmado hasta que alguien
    // intenta verificarlo, normalmente delante del auditor.
    await expect(exportAuditTrail({ auth: AUDITOR, format: 'csv' })).rejects.toMatchObject({
      code: 'AUDIT_SIGNING_UNAVAILABLE',
    });
    // Y no deja rastro de una exportación que no ocurrió.
    expect(repository.saved).toHaveLength(0);
  });

  it('el CSV escapa comillas y comas del detalle', async () => {
    const { exportAuditTrail } = build(
      [log('RESOLVE_CASE', { reason: 'dijo "no", y se fue' })],
      ed25519Pem(),
    );

    const trail = await exportAuditTrail({ auth: AUDITOR, format: 'csv' });
    const [cabecera, fila] = trail.body.toString('utf8').split('\n');

    expect(cabecera).toBe(
      'created_at,organization_id,actor_type,actor_id,action,resource,resource_id,ip_address,detail',
    );

    /*
     * Lo que importa no es cómo quedó escapado, sino que la fila SIGUE
     * teniendo nueve celdas.
     *
     * El detalle lleva una coma dentro; sin entrecomillar la celda, esa coma
     * partiría la fila en diez y el CSV dejaría de cuadrar a partir de ahí. Se
     * cuenta con un lector que respeta las comillas en vez de buscar una
     * secuencia concreta de caracteres: el detalle se serializa a JSON ANTES
     * de escaparse, así que la forma exacta depende de dos capas y afirmarla
     * sería frágil sin probar nada más.
     */
    expect(parseCsvRow(fila!)).toHaveLength(9);
    // Y la última celda, ya desescapada, es el JSON original intacto.
    expect(JSON.parse(parseCsvRow(fila!)[8]!)).toEqual({ reason: 'dijo "no", y se fue' });
  });

  it('el JSON es una fila por línea, no un array', async () => {
    const { exportAuditTrail } = build([log('A'), log('B')], ed25519Pem());

    const trail = await exportAuditTrail({ auth: AUDITOR, format: 'json' });
    const lineas = trail.body.toString('utf8').trim().split('\n');

    expect(lineas).toHaveLength(2);
    // Cada línea se parsea sola: no hace falta el documento entero para leer
    // la primera fila.
    expect(JSON.parse(lineas[0]!).action).toBe('A');
    expect(trail.contentType).toBe('application/x-ndjson');
  });

  it('deja traza de la exportación CON el hash del fichero', async () => {
    const { exportAuditTrail, repository } = build([log('RESOLVE_CASE')], ed25519Pem());

    const trail = await exportAuditTrail({ auth: AUDITOR, format: 'csv' });

    const [event] = repository.saved;
    expect(event!.action).toBe('EXPORT_AUDIT_TRAIL');
    // El hash es lo que permite decir, meses después, si un fichero que
    // aparece por ahí es el que se emitió.
    expect(event!.detail.sha256).toBe(trail.sha256);
    expect(event!.detail.rowCount).toBe(1);
  });

  it('un ANALYST no puede exportar la bitácora', async () => {
    const { exportAuditTrail } = build([log('RESOLVE_CASE')], ed25519Pem());

    await expect(exportAuditTrail({ auth: ANALYST, format: 'csv' })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('un SUPERVISOR tampoco: es de los auditados', async () => {
    const { exportAuditTrail } = build([log('RESOLVE_CASE')], ed25519Pem());

    // Un investigado que puede leer —y cronometrar— el registro de lo que hizo
    // convierte la traza en un aviso.
    await expect(exportAuditTrail({ auth: SUPERVISOR, format: 'csv' })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('rechaza una clave que no es Ed25519, al construirla', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    // Al arrancar y no al primer export: descubrirlo el día que un auditor
    // pide el fichero es el peor momento posible.
    expect(() => new Ed25519TrailSigner(pem)).toThrow(/Ed25519/);
  });
});
