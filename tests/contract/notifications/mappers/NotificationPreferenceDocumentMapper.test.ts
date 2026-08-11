import { ObjectId } from 'mongodb';
import {
  toDomain,
  toUpsertFields,
} from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/mappers/NotificationPreferenceDocumentMapper.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import type { NotificationPreferenceDocument } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationPreferenceDocument.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('NotificationPreferenceDocumentMapper', () => {
  describe('toDomain', () => {
    it('maps a PascalCase document to the domain aggregate, dropping _id', () => {
      const document: NotificationPreferenceDocument = {
        _id: new ObjectId(),
        OrganizationId: 'org-1',
        UserId: 'user-1',
        AlertType: 'CASO_ASIGNADO',
        Channel: 'EMAIL',
        Enabled: false,
        CreatedAt: NOW,
        UpdatedAt: NOW,
      };

      const pref = toDomain(document);

      expect(pref.organizationId).toBe('org-1');
      expect(pref.userId).toBe('user-1');
      expect(pref.alertType).toBe('CASO_ASIGNADO');
      expect(pref.channel).toBe('EMAIL');
      expect(pref.enabled).toBe(false);
      expect(pref.createdAt).toBe(NOW);
      expect(pref.updatedAt).toBe(NOW);
    });
  });

  describe('toUpsertFields', () => {
    it('splits the desired post-state into key/$set/$setOnInsert fragments, never writing _id', () => {
      const pref = NotificationPreference.create({
        organizationId: createOrganizationId('org-1'),
        userId: createUserId('user-1'),
        alertType: 'RIESGO_CRITICO',
        channel: 'EMAIL',
        enabled: true,
        now: NOW,
      });

      const fields = toUpsertFields(pref);

      expect(fields.key).toEqual({
        OrganizationId: 'org-1',
        UserId: 'user-1',
        AlertType: 'RIESGO_CRITICO',
        Channel: 'EMAIL',
      });
      expect(fields.set).toEqual({ Enabled: true, UpdatedAt: NOW });
      expect(fields.setOnInsert).toEqual({ CreatedAt: NOW });
      expect(fields).not.toHaveProperty('_id');
    });
  });
});
