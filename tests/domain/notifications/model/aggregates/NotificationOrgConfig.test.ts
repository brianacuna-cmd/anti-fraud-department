import { oid } from '../../../../support/oid.js';
import { NotificationOrgConfig } from '../../../../../src/modules/notifications/domain/model/aggregates/NotificationOrgConfig.js';
import { createNotificationOrgConfigId } from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function baseInput() {
  return {
    id: createNotificationOrgConfigId(oid('config-1')),
    organizationId: createOrganizationId(oid('org-1')),
    now: NOW,
  };
}

describe('NotificationOrgConfig.create', () => {
  it('accepts a valid https webhookUrl', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'https://hooks.example.com/x' });

    expect(config.webhookUrl).toBe('https://hooks.example.com/x');
    expect(config.createdAt).toBe(NOW);
    expect(config.updatedAt).toBe(NOW);
  });

  it('accepts a valid http webhookUrl', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'http://hooks.example.com/x' });

    expect(config.webhookUrl).toBe('http://hooks.example.com/x');
  });

  it('accepts a null webhookUrl (unset)', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), webhookUrl: null });

    expect(config.webhookUrl).toBeNull();
  });

  it('defaults webhookUrl to null when omitted', () => {
    const config = NotificationOrgConfig.create(baseInput());

    expect(config.webhookUrl).toBeNull();
  });

  it('rejects a non-URL string', () => {
    expect(() => NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'not-a-url' })).toThrow(NotificationsError);
  });

  it('rejects a non-http(s) scheme (ftp://)', () => {
    expect(() => NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'ftp://host/x' })).toThrow(NotificationsError);
  });

  it('rejects a malformed string', () => {
    expect(() => NotificationOrgConfig.create({ ...baseInput(), webhookUrl: '://broken' })).toThrow(NotificationsError);
  });

  it('carries an optional secret', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), secret: 'super-secret' });

    expect(config.secret).toBe('super-secret');
  });
});

describe('NotificationOrgConfig.rehydrate', () => {
  it('reconstructs from persisted props with no validation', () => {
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));
    const config = NotificationOrgConfig.rehydrate({
      id: createNotificationOrgConfigId(oid('config-1')),
      organizationId: createOrganizationId(oid('org-1')),
      webhookUrl: 'https://hooks.example.com/x',
      secret: null,
      createdAt: NOW,
      updatedAt: later,
    });

    expect(config.webhookUrl).toBe('https://hooks.example.com/x');
    expect(config.updatedAt).toBe(later);
  });
});

describe('NotificationOrgConfig.update', () => {
  it('patches webhookUrl and bumps updatedAt', () => {
    const config = NotificationOrgConfig.create(baseInput());
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));

    const updated = config.update({ webhookUrl: 'https://new.example.com/hook' }, later);

    expect(updated.webhookUrl).toBe('https://new.example.com/hook');
    expect(updated.updatedAt).toBe(later);
    expect(updated.createdAt).toBe(NOW);
  });

  it('keeps the current webhookUrl when patch field is undefined', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'https://hooks.example.com/x' });
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));

    const updated = config.update({}, later);

    expect(updated.webhookUrl).toBe('https://hooks.example.com/x');
  });

  it('clears webhookUrl when patch field is explicitly null', () => {
    const config = NotificationOrgConfig.create({ ...baseInput(), webhookUrl: 'https://hooks.example.com/x' });
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));

    const updated = config.update({ webhookUrl: null }, later);

    expect(updated.webhookUrl).toBeNull();
  });

  it('rejects an invalid webhookUrl patch', () => {
    const config = NotificationOrgConfig.create(baseInput());
    const later = fromDate(new Date('2026-01-02T00:00:00.000Z'));

    expect(() => config.update({ webhookUrl: 'not-a-url' }, later)).toThrow(NotificationsError);
  });
});
