import { oid } from '../../../support/oid.js';
import {
  toPreferenceResponse,
  toPreferenceMatrixResponse,
} from '../../../../src/modules/notifications/infrastructure/adapters/inbound/http/mappers/NotificationPreferenceHttpMapper.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('toPreferenceResponse', () => {
  it('maps a NotificationPreference to wire shape, domain->wire alertType casing, no id/org leak', () => {
    const pref = NotificationPreference.create({
      organizationId: createOrganizationId(oid('org-1')),
      userId: createUserId(oid('user-1')),
      alertType: 'CASO_ASIGNADO',
      channel: 'EMAIL',
      enabled: false,
      now: NOW,
    });

    const dto = toPreferenceResponse(pref);

    expect(dto).toEqual({ alertType: 'caso_asignado', channel: 'EMAIL', enabled: false, updatedAt: NOW });
    expect(dto).not.toHaveProperty('organizationId');
    expect(dto).not.toHaveProperty('userId');
  });
});

describe('toPreferenceMatrixResponse', () => {
  it('maps a 4-entry effective matrix, domain->wire alertType casing on every entry', () => {
    const dto = toPreferenceMatrixResponse([
      { alertType: 'CASO_ASIGNADO', channel: 'EMAIL', enabled: true },
      { alertType: 'RIESGO_CRITICO', channel: 'EMAIL', enabled: false },
    ]);

    expect(dto.items).toEqual([
      { alertType: 'caso_asignado', channel: 'EMAIL', enabled: true },
      { alertType: 'riesgo_critico', channel: 'EMAIL', enabled: false },
    ]);
  });
});
