import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type {
  AmlExpedienteTimelineEvent,
  AmlExpedienteTimelineRecorder,
} from '../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { createGetAmlAlertUseCase } from './GetAmlAlert.js';

export interface GetAmlAlertTimelineInput {
  readonly auth: AuthContext;
  readonly alertId: string;
}

export interface GetAmlAlertTimelineDeps {
  readonly getAmlAlert: ReturnType<typeof createGetAmlAlertUseCase>;
  readonly timelineRecorder: AmlExpedienteTimelineRecorder;
}

/** Oldest-first timeline of one AML alert. Reuses GetAmlAlert tenant gates. */
export function createGetAmlAlertTimelineUseCase(deps: GetAmlAlertTimelineDeps) {
  return async function getAmlAlertTimeline(
    input: GetAmlAlertTimelineInput,
  ): Promise<AmlExpedienteTimelineEvent[]> {
    const alert = await deps.getAmlAlert(input);
    return deps.timelineRecorder.listByAlertId(String(alert.id));
  };
}
