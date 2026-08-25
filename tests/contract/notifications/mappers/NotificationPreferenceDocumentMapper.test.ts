import { oid } from '../../../support/oid.js';
import { ObjectId } from 'mongodb';
import {
  toDomain,
  toUpsertFields,
} from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/mappers/NotificationPreferenceDocumentMapper.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import type { NotificationPreferenceDocument } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationPreferenceDocument.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('NotificationPreferenceDocumentMapper', () => {
  describe('toDomain', () => {
    it('maps a snake_case document to the domain aggregate, dropping _id', () => {
      const document: NotificationPreferenceDocument = {
        _id: new ObjectId(),
        organization_id: new ObjectId(oid('org-1')),
        user_id: new ObjectId(oid('user-1')),
        alert_type: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        enabled: false,
        created_at: toDate(NOW),
        updated_at: toDate(NOW),
      };

      const pref = toDomain(document);

      expect(pref.organizationId).toBe(oid('org-1'));
      expect(pref.userId).toBe(oid('user-1'));
      expect(pref.alertType).toBe('CASE_ASSIGNED');
      expect(pref.channel).toBe('EMAIL');
      expect(pref.enabled).toBe(false);
      expect(pref.createdAt).toBe(NOW);
      expect(pref.updatedAt).toBe(NOW);
    });

    it('normalizes a legacy Spanish alert_type column to the English domain value', () => {
      const document: NotificationPreferenceDocument = {
        _id: new ObjectId(),
        organization_id: new ObjectId(oid('org-1')),
        user_id: new ObjectId(oid('user-1')),
        alert_type: 'CASO_ASIGNADO',
        channel: 'EMAIL',
        enabled: true,
        created_at: toDate(NOW),
        updated_at: toDate(NOW),
      };

      expect(toDomain(document).alertType).toBe('CASE_ASSIGNED');
    });
  });

  describe('toUpsertFields', () => {
    it('splits the desired post-state into key/$set/$setOnInsert fragments, never writing _id', () => {
      const pref = NotificationPreference.create({
        organizationId: createOrganizationId(oid('org-1')),
        userId: createUserId(oid('user-1')),
        alertType: 'CRITICAL_RISK',
        channel: 'EMAIL',
        enabled: true,
        now: NOW,
      });

      const fields = toUpsertFields(pref);

      expect(fields.key).toEqual({
        organization_id: new ObjectId(oid('org-1')),
        user_id: new ObjectId(oid('user-1')),
        alert_type: 'CRITICAL_RISK',
        channel: 'EMAIL',
      });
      expect(fields.set).toEqual({ enabled: true, updated_at: toDate(NOW) });
      expect(fields.setOnInsert).toEqual({ created_at: toDate(NOW) });
      expect(fields).not.toHaveProperty('_id');
    });
  });
});
