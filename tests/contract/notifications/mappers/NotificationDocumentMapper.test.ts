import { ObjectId } from 'mongodb';
import { oid } from '../../../support/oid.js';
import { toDocument, toDomain } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/mappers/NotificationDocumentMapper.js';
import { Notification } from '../../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import type { NotificationDocument } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationDocument.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('NotificationDocumentMapper round-trip', () => {
  it('toDocument -> toDomain preserves all fields', () => {
    const notification = Notification.create({
      id: createNotificationId(oid('notification-1')),
      organizationId: createOrganizationId(oid('org-1')),
      recipientUserId: createUserId(oid('user-1')),
      alertType: 'CASO_ASIGNADO',
      channel: 'EMAIL',
      context: { caseId: oid('case-1'), previousAssigneeId: null },
      now: NOW,
    });

    const document = toDocument(notification);
    expect(document._id).toEqual(new ObjectId(oid('notification-1')));
    expect(document.organization_id).toEqual(new ObjectId(oid('org-1')));
    expect(document.recipient_user_id).toEqual(new ObjectId(oid('user-1')));
    expect(document.alert_type).toBe('CASO_ASIGNADO');
    expect(document.channel).toBe('EMAIL');
    expect(document.context).toEqual({ caseId: oid('case-1'), previousAssigneeId: null });
    expect(document.created_at).toEqual(toDate(NOW));

    const rehydrated = toDomain(document);
    expect(rehydrated.id).toBe(oid('notification-1'));
    expect(rehydrated.organizationId).toBe(oid('org-1'));
    expect(rehydrated.recipientUserId).toBe(oid('user-1'));
    expect(rehydrated.alertType).toBe('CASO_ASIGNADO');
    expect(rehydrated.channel).toBe('EMAIL');
    expect(rehydrated.context).toEqual({ caseId: oid('case-1'), previousAssigneeId: null });
    expect(rehydrated.createdAt).toEqual(NOW);
  });

  it('toDomain drops nothing extra from a raw document', () => {
    const document: NotificationDocument = {
      _id: new ObjectId(oid('notification-2')),
      organization_id: new ObjectId(oid('org-1')),
      recipient_user_id: new ObjectId(oid('user-2')),
      alert_type: 'SLA_POR_VENCER',
      channel: 'EMAIL',
      context: {},
      created_at: toDate(NOW),
    };

    const domain = toDomain(document);
    expect(domain.alertType).toBe('SLA_POR_VENCER');
    expect(domain.context).toEqual({});
  });
});
