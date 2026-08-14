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
