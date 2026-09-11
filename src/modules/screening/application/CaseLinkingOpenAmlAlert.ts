import type { Clock } from '../../../shared/time/Clock.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { WalletRescreenCaseLinker } from '../domain/ports/WalletRescreenCaseLinker.js';
import type { OpenAmlAlertInput, OpenAmlAlertResult } from './OpenAmlAlert.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CaseLinkingOpenAmlAlertDeps {
  readonly openAmlAlert: (input: OpenAmlAlertInput) => Promise<OpenAmlAlertResult>;
  readonly caseLinker: WalletRescreenCaseLinker;
  readonly amlAlertRepository: AmlAlertRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Wraps `openAmlAlert` so a NEWLY opened alert is linked to the customer's
 * open fraud case, if there is one — what the wallet rescreen already does,
 * made reusable for the customer rescreen.
 *
 * A wrapper with `openAmlAlert`'s exact signature rather than a step inside
 * the rescreen: `ScreenSubjectAgainstWatchlist` opens alerts through an
 * injected `openAmlAlert`, so handing it this function links every alert the
 * nightly name rescreen raises without touching the screening engine.
 * Duplicates are returned untouched — they were linked when first opened.
 */
export function createCaseLinkingOpenAmlAlert(deps: CaseLinkingOpenAmlAlertDeps) {
  return async function openAndLinkAmlAlert(input: OpenAmlAlertInput): Promise<OpenAmlAlertResult> {
    const result = await deps.openAmlAlert(input);
    if (!result.opened || result.alert === null) return result;

    const caseId = await deps.caseLinker.find(requireTenantContext(input.auth), input.customerId);
    if (caseId === null) return result;

    const linked = result.alert.linkCase(caseId, deps.clock.now());
    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.amlAlertRepository.save(linked, tx);
    });
    return { ...result, alert: linked };
  };
}
