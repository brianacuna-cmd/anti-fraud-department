import { connectMongo } from '../src/shared/persistence/mongo/connect.js';
import { createAuthContext } from '../src/shared/kernel/AuthContext.js';
import { SystemClock } from '../src/shared/time/SystemClock.js';
import { MongoAuditLogRepository } from '../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createRiskAssessmentAuditRecorderAdapter } from '../src/composition/riskAssessmentAuditRecorderAdapter.js';
import { MongoRiskScoringRuleRepository } from '../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoRiskScoringRuleRepository.js';
import { MongoUnitOfWork } from '../src/modules/risk-assessment/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { createCreateScoringRuleUseCase } from '../src/modules/risk-assessment/application/CreateScoringRule.js';
import { createActivateScoringRuleUseCase } from '../src/modules/risk-assessment/application/ActivateScoringRule.js';
import { createListScoringRulesUseCase } from '../src/modules/risk-assessment/application/ListScoringRules.js';
import { generateRiskScoringRuleId } from '../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { buildFactorScoringJdm } from '../src/modules/risk-assessment/domain/services/factorScoringJdm.js';
import { FRAUD_RULES_NAME, FRAUD_RULE_FACTORS } from './createFraudRulesCore.js';

/**
 * Creates and activates the six payment fraud rules for the default
 * organization (DEFAULT_ORGANIZATION_ID) straight in its database, through
 * the same use cases as the API: same graph, same validation, same audit row
 * (actor: the organization).
 *
 *   pnpm rules:activate-fraud-db            # only reports
 *   pnpm rules:activate-fraud-db --confirm  # creates and activates
 *
 * Env (read from .env): MONGO_URI, MONGO_DB_NAME, DEFAULT_ORGANIZATION_ID.
 */
async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const mongoDbName = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';
  const organizationId = process.env.DEFAULT_ORGANIZATION_ID ?? '019d7e58aed0777318d11d4d';
  const confirm = process.argv.includes('--confirm');

  const { client, db } = await connectMongo(mongoUri, mongoDbName);
  try {
    const clock = new SystemClock();
    const scoringRules = new MongoRiskScoringRuleRepository(db);
    const auditRecorder = createRiskAssessmentAuditRecorderAdapter(
      createRecordAuditLogUseCase({ auditLogs: new MongoAuditLogRepository(db), clock, generateAuditLogId }),
    );
    const auth = createAuthContext({ userId: organizationId, organizationId, actorType: 'ORGANIZATION' });

    const rules = await createListScoringRulesUseCase({ scoringRules })({ auth });
    const active = rules.find((rule) => rule.status === 'ACTIVE') ?? null;
    console.log(`Base: ${mongoDbName} · organización ${organizationId}`);
    console.log(`Reglas existentes: ${rules.length}. Activa: ${active ? `"${active.name}" (${active.id})` : 'ninguna'}.`);

    if (active?.name === FRAUD_RULES_NAME) {
      console.log('Las 6 reglas ya están activas. No se cambia nada.');
      return;
    }
    if (!confirm) {
      console.log(
        active
          ? 'Activar la nueva RETIRA la regla activa. Repite con --confirm para crear y activar.'
          : 'Repite con --confirm para crear y activar.',
      );
      return;
    }

    const created = await createCreateScoringRuleUseCase({ scoringRules, auditRecorder, clock, generateRiskScoringRuleId })({
      auth,
      name: FRAUD_RULES_NAME,
      conditions: buildFactorScoringJdm(FRAUD_RULE_FACTORS, 'MAX'),
      conditionsVersion: 1,
    });
    const activated = await createActivateScoringRuleUseCase({
      scoringRules,
      unitOfWork: new MongoUnitOfWork(client),
      auditRecorder,
      clock,
    })({ auth, ruleId: created.id });
    console.log(`Regla creada y activada: "${activated.name}" (${activated.id}).${active ? ` Retirada: "${active.name}".` : ''}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
