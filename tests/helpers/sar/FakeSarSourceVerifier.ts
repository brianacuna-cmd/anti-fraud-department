import type { SarSourceCheck, SarSourceVerifier } from '../../../src/modules/sar/domain/ports/SarSourceVerifier.js';

const NOT_FOUND: SarSourceCheck = { exists: false, eligible: false };

/** In-memory `SarSourceVerifier` double — seed with `.allowCase`/`.allowAmlAlert`. */
export class FakeSarSourceVerifier implements SarSourceVerifier {
  private readonly cases = new Map<string, SarSourceCheck>();
  private readonly amlAlerts = new Map<string, SarSourceCheck>();

  allowCase(caseId: string, eligible: boolean): void {
    this.cases.set(caseId, { exists: true, eligible });
  }

  allowAmlAlert(amlAlertId: string, eligible: boolean): void {
    this.amlAlerts.set(amlAlertId, { exists: true, eligible });
  }

  async verifyCase(_organizationId: string, caseId: string): Promise<SarSourceCheck> {
    return this.cases.get(caseId) ?? NOT_FOUND;
  }

  async verifyAmlAlert(_organizationId: string, amlAlertId: string): Promise<SarSourceCheck> {
    return this.amlAlerts.get(amlAlertId) ?? NOT_FOUND;
  }
}
