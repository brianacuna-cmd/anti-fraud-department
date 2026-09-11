import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { createQueryAuditLogsUseCase } from '../../../../application/QueryAuditLogs.js';
import type { createExportAuditTrailUseCase } from '../../../../application/ExportAuditTrail.js';
import { exportAuditTrailSchema, queryAuditLogsSchema } from './dto/auditLogSchemas.js';
import { toAuditLogResponse } from './mappers/AuditLogHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface AuditLogRouterDeps {
  readonly queryAuditLogs: ReturnType<typeof createQueryAuditLogsUseCase>;
  readonly exportAuditTrail: ReturnType<typeof createExportAuditTrailUseCase>;
}

/**
 * Rutas `/audit-logs` (AUD-002 y AUD-003).
 *
 * `/audit-logs/export` se registra ANTES que cualquier `/audit-logs/:algo`
 * para que Express no resuelva el literal "export" como un parámetro. Hoy no
 * hay ruta con parámetro, pero la primera que se añada heredaría el fallo.
 */
export function auditLogRouter(deps: AuditLogRouterDeps): Router {
  const router = Router();

  // AUD-003
  router.get('/audit-logs/export', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(exportAuditTrailSchema, req.query);

    const trail = await deps.exportAuditTrail({
      auth,
      format: query.format,
      actorId: query.actorId,
      actorType: query.actorType,
      action: query.action,
      resource: query.resource,
      from: query.from === undefined ? undefined : fromDate(new Date(query.from)),
      to: query.to === undefined ? undefined : fromDate(new Date(query.to)),
    });

    /*
     * La firma viaja en CABECERAS, no dentro del cuerpo.
     *
     * Si fuera dentro, el fichero contendría su propia firma y verificarlo
     * exigiría quitarla primero — un paso que el auditor tendría que hacer
     * exactamente igual que lo hicimos nosotros para que los bytes cuadren, y
     * cualquier diferencia de formato invalidaría una firma correcta. Fuera
     * del cuerpo, lo que se firma es literalmente el fichero descargado.
     */
    res.setHeader('Content-Type', trail.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${trail.filename}"`);
    res.setHeader('X-Audit-Rows', String(trail.rowCount));
    res.setHeader('X-Audit-SHA256', trail.sha256);
    res.setHeader('X-Audit-Signature-Algorithm', trail.signature.algorithm);
    res.setHeader('X-Audit-Signature', trail.signature.signature);
    // La clave pública en base64 para no romper la cabecera con los saltos de
    // línea del PEM, que HTTP no admite.
    res.setHeader(
      'X-Audit-Public-Key',
      Buffer.from(trail.signature.publicKeyPem, 'utf8').toString('base64'),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(trail.body);
  });

  // AUD-002
  router.get('/audit-logs', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(queryAuditLogsSchema, req.query);

    const page = await deps.queryAuditLogs({
      auth,
      actorId: query.actorId,
      actorType: query.actorType,
      action: query.action,
      resource: query.resource,
      resourceId: query.resourceId,
      ipAddress: query.ipAddress,
      from: query.from === undefined ? undefined : fromDate(new Date(query.from)),
      to: query.to === undefined ? undefined : fromDate(new Date(query.to)),
      limit: query.limit,
      offset: query.offset,
    });

    res.status(200).json({
      items: page.items.map(toAuditLogResponse),
      total: page.total,
    });
  });

  return router;
}
