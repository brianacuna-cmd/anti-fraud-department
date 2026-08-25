import { Router, type Request, type Response } from 'express';
import type { createIngestFinturuCaseUseCase } from '../../../../application/IngestFinturuCase.js';
import { decryptFinturuPayload } from './FinturuPayloadDecryptor.js';

export interface FinturuWebhookRouterDeps {
  readonly ingestFinturuCase: ReturnType<typeof createIngestFinturuCaseUseCase>;
  readonly defaultOrganizationId?: string;
  readonly encryptionKey?: string;
}

export function finturuWebhookRouter(deps: FinturuWebhookRouterDeps): Router {
  const router = Router();

  const handleIngestion = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Decrypt AES-256-GCM payload if encrypted, or parse plain JSON
      const rawPayload = decryptFinturuPayload(req.body, deps.encryptionKey);

      // 2. Resolve organization from header or query or default
      const headerOrg = req.headers['x-organization-id'] as string | undefined;
      const queryOrg = req.query.org as string | undefined;
      const organizationId = headerOrg ?? queryOrg ?? deps.defaultOrganizationId;

      // 3. Execute Ingestion Use Case
      const result = await deps.ingestFinturuCase({
        rawPayload,
        organizationId,
        defaultOrganizationId: deps.defaultOrganizationId,
        ipAddress: req.ip ?? req.socket.remoteAddress,
      });

      res.status(201).json({
        success: true,
        caseId: result.case.id,
        status: result.case.status,
        riskScore: result.case.riskScore,
        priority: result.case.priority,
        customerId: result.case.customerId,
        customerEmail: result.case.customerEmail,
        bridgeUserId: result.case.bridgeUserId,
        bridgeWallet: result.case.bridgeWallet,
        stripeCustomerId: result.case.stripeCustomerId,
        outboxEventId: result.outboxEventId,
        message: 'Finturu payload ingested successfully',
      });
    } catch (error) {
      const message = (error as Error).message;
      res.status(400).json({
        success: false,
        error: message,
      });
    }
  };

  // Dual mount: /webhooks/finturu and /cases/webhook/finturu
  router.post('/webhooks/finturu', handleIngestion);
  router.post('/cases/webhook/finturu', handleIngestion);

  return router;
}
