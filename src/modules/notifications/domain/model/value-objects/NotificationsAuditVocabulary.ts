/**
 * notifications' own closed Action/Resource vocabulary for audit emission
 * (design D2). Plain unions, NOT branded — same rule as `AlertType`: a closed
 * enum of known values, not an opaque id.
 *
 * The `audit` module's `AuditLogRepository`/`RecordAuditLog` accept plain
 * `string` (audit cannot know other modules' vocabulary). Widening from this
 * union to `string` happens implicitly at the `AuditRecorder` -> composition
 * bridge (design D12).
 */
export type NotificationsAuditAction = 'NOTIFICATION_PREFERENCE_UPDATED';

export type NotificationsAuditResource = 'notificationPreferences';
