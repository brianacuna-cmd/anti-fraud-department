import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');

describe('src/main.ts risk-assessment wiring', () => {
  it('wires MongoRiskScoringRuleRepository, ZenRiskScoringEngine, CalculateRiskScore, audit adapter, error map, and router', () => {
    expect(MAIN).toContain('MongoRiskScoringRuleRepository');
    expect(MAIN).toContain('ZenRiskScoringEngine');
    expect(MAIN).toContain('createCalculateRiskScoreUseCase');
    expect(MAIN).toContain('createRiskAssessmentAuditRecorderAdapter');
    expect(MAIN).toContain('riskAssessmentErrorStatus');
    expect(MAIN).toContain('riskScoreRouter');
  });

  it('wires scoring-rule draft/activate API with RiskAssessment MongoUnitOfWork', () => {
    expect(MAIN).toContain('RiskAssessmentMongoUnitOfWork');
    expect(MAIN).toContain('createCreateScoringRuleUseCase');
    expect(MAIN).toContain('createActivateScoringRuleUseCase');
    expect(MAIN).toContain('createListScoringRulesUseCase');
    expect(MAIN).toContain('createGetScoringRuleUseCase');
    expect(MAIN).toContain('scoringRuleRouter');
    expect(MAIN).toContain('generateRiskScoringRuleId');
  });

  it('deriveScreeningInput reads identity from event.subjectIdentity, not riskSignals', () => {
    const fnStart = MAIN.indexOf('function deriveScreeningInput');
    const fnBody = MAIN.slice(fnStart, MAIN.indexOf('\n}', fnStart) + 2);

    expect(fnBody).toContain('event.subjectIdentity');
    expect(fnBody).not.toContain('event.riskSignals');
    expect(fnBody).not.toContain('riskSignals.entryType');
    expect(fnBody).not.toContain('riskSignals.nombre');
    expect(fnBody).not.toContain('riskSignals.documento');
    expect(fnBody).not.toContain('riskSignals.walletAddress');
  });

  it('wires MongoOrganizationScreeningConfigRepository + GetOrganizationScreeningConfig and resolves per-org thresholds before screening (D-8)', () => {
    expect(MAIN).toContain('MongoOrganizationScreeningConfigRepository');
    expect(MAIN).toContain('createGetOrganizationScreeningConfigUseCase');
    expect(MAIN).toContain('getOrganizationScreeningConfig');

    const wrapperStart = MAIN.indexOf('const processRiskScoreToCaseWithScreening');
    const wrapperBody = MAIN.slice(wrapperStart, MAIN.indexOf('\n\n', wrapperStart));
    expect(wrapperBody).toContain('getOrganizationScreeningConfig');
    expect(wrapperBody).toContain('thresholds');
  });

  it('does not inject scoring into createCreateCaseUseCase', () => {
    const createCaseBlock = MAIN.slice(
      MAIN.indexOf('createCreateCaseUseCase({'),
      MAIN.indexOf('});', MAIN.indexOf('createCreateCaseUseCase({')) + 3,
    );

    expect(createCaseBlock).toContain('createCreateCaseUseCase');
    expect(createCaseBlock).not.toContain('calculateRiskScore');
    expect(createCaseBlock).not.toContain('ZenRiskScoringEngine');
  });
});
