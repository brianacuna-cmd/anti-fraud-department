import type { AuthContext } from '../shared/kernel/AuthContext.js';
import type { Case } from '../modules/case-management/domain/model/aggregates/Case.js';
import type { CaseRepository } from '../modules/case-management/domain/ports/CaseRepository.js';
import { entityIdentifiersOf } from '../modules/case-management/domain/services/EntityNetworkGraph.js';
import type { createGetCaseUseCase } from '../modules/case-management/application/GetCase.js';
import type { createGetCaseTimelineUseCase } from '../modules/case-management/application/GetCaseTimeline.js';
import { toCaseResponse } from '../modules/case-management/infrastructure/adapters/inbound/http/mappers/CaseHttpMapper.js';
import { toTimelineEventResponse } from '../modules/case-management/infrastructure/adapters/inbound/http/mappers/CaseTimelineHttpMapper.js';
import { toAmlAlertResponse } from '../modules/screening/infrastructure/adapters/inbound/http/mappers/AmlAlertHttpMapper.js';
import type { createListAmlAlertsUseCase } from '../modules/screening/application/ListAmlAlerts.js';

export const RELATED_CASES_LIMIT = 50;
export const AML_PACK_LIMIT = 100;

export interface GetCaseAnalysisPackInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface CaseAnalysisPack {
  readonly case: ReturnType<typeof toCaseResponse>;
  readonly timeline: ReturnType<typeof toTimelineEventResponse>[];
  readonly snapshot: Record<string, unknown> | null;
  readonly amlAlerts: ReturnType<typeof toAmlAlertResponse>[];
  readonly relatedCases: ReturnType<typeof toCaseResponse>[];
  readonly agentBrief: null;
}

export interface GetCaseAnalysisPackDeps {
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly getCaseTimeline: ReturnType<typeof createGetCaseTimelineUseCase>;
  readonly listAmlAlerts: ReturnType<typeof createListAmlAlertsUseCase>;
  readonly cases: CaseRepository;
}

export function entityRefsFromCase(kase: Case) {
  return entityIdentifiersOf(kase);
}

export function createGetCaseAnalysisPack(deps: GetCaseAnalysisPackDeps) {
  return async function getCaseAnalysisPack(
    input: GetCaseAnalysisPackInput,
  ): Promise<CaseAnalysisPack> {
    const kase = await deps.getCase(input);
    const timeline = await deps.getCaseTimeline(input);
    const aml = await deps.listAmlAlerts({
      auth: input.auth,
      customerId: kase.customerId,
      limit: AML_PACK_LIMIT,
      offset: 0,
    });
    const related = (
      await deps.cases.findByEntityIdentifiers({
        organizationId: kase.organizationId,
        refs: entityRefsFromCase(kase),
        limit: RELATED_CASES_LIMIT + 1,
      })
    )
      .filter((sibling) => sibling.id !== kase.id)
      .slice(0, RELATED_CASES_LIMIT);

    return {
      case: toCaseResponse(kase),
      timeline: timeline.map(toTimelineEventResponse),
      snapshot: kase.finturuCacheSnapshot,
      amlAlerts: aml.items.map(toAmlAlertResponse),
      relatedCases: related.map(toCaseResponse),
      agentBrief: null,
    };
  };
}
