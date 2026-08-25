import { oid } from '../../../../support/oid.js';
import { NotificationPreference } from '../../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function baseInput() {
  return {
    organizationId: createOrganizationId(oid('org-1')),
    userId: createUserId(oid('user-1')),
    alertType: createAlertType('SLA_DUE_SOON'),
    channel: createNotificationChannel('EMAIL'),
    enabled: false,
    now: NOW,
  };
}

describe('NotificationPreference.create', () => {
  it('stamps createdAt and updatedAt equal to now', () => {
    const pref = NotificationPreference.create(baseInput());

    expect(pref.createdAt).toBe(NOW);
    expect(pref.updatedAt).toBe(NOW);
  });

  it('carries the given props verbatim', () => {
    const pref = NotificationPreference.create(baseInput());

    expect(pref.organizationId).toBe(oid('org-1'));
    expect(pref.userId).toBe(oid('user-1'));
    expect(pref.alertType).toBe('SLA_DUE_SOON');
    expect(pref.channel).toBe('EMAIL');
    expect(pref.enabled).toBe(false);
  });
});

describe('NotificationPreference.rehydrate', () => {
  it('reconstructs from persisted props with no validation', () => {
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const props = { ...baseInput(), enabled: true, createdAt: NOW, updatedAt: later };
    delete (props as { now?: unknown }).now;

    const pref = NotificationPreference.rehydrate(props as never);

    expect(pref.enabled).toBe(true);
    expect(pref.createdAt).toBe(NOW);
    expect(pref.updatedAt).toBe(later);
  });
});

describe('NotificationPreference immutability', () => {
  it('exposes only readonly getters, no setters', () => {
    const pref = NotificationPreference.create(baseInput());

    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pref), 'enabled')?.set).toBeUndefined();
  });
});
