import { oid } from '../support/oid.js';
import { createNotificationEmailSenderAdapter } from '../../src/composition/notificationEmailSenderAdapter.js';
import type { MongoUserRepositoryFactory } from '../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { InMemoryUserRepositoryFactory } from '../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { FakeEmailSender } from '../helpers/identity-access/FakeEmailSender.js';
import { User } from '../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createRoleId } from '../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import type { RoleId } from '../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import type { NotificationEmailInput } from '../../src/modules/notifications/domain/ports/NotificationEmailSender.js';
import type { OrganizationId as NotificationOrganizationId } from '../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import type { UserId as NotificationUserId } from '../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../src/modules/notifications/domain/model/value-objects/AlertType.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-notify');
const USER_ID = oid('user-notify');
const USER_EMAIL = 'analyst@example.com';
/** Stands in for NOTIFICATION_EMAIL_FROM when set (main.ts wiring is out of scope). */
const NOTIFICATION_EMAIL_FROM = 'alerts@example.com';
const CREDENTIAL = createPasswordCredential('hash-value');

function asMongoFactory(factory: InMemoryUserRepositoryFactory): MongoUserRepositoryFactory {
  return factory as unknown as MongoUserRepositoryFactory;
}

function buildUser(): User {
  return User.create({
    id: createUserId(USER_ID),
    organizationId: createOrganizationId(ORG),
    email: createEmail(USER_EMAIL),
    credential: CREDENTIAL,
    firstName: 'Test',
    lastName: 'User',
    roleId: createRoleId('ANALYST') as RoleId,
    now: NOW,
  });
}

function input(overrides: Partial<NotificationEmailInput> = {}): NotificationEmailInput {
  return {
    organizationId: ORG as NotificationOrganizationId,
    recipientUserId: USER_ID as NotificationUserId,
    alertType: createAlertType('CASE_ASSIGNED'),
    context: {},
    ...overrides,
  };
}

async function seedFoundUser(users: InMemoryUserRepositoryFactory): Promise<void> {
  await users.forTenant(createOrganizationId(ORG)).save(buildUser());
}

describe('createNotificationEmailSenderAdapter', () => {
  it('sends English copy, from, and to when the recipient user exists', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input({ alertType: createAlertType('CASE_ASSIGNED') }));

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].to).toBe(USER_EMAIL);
    expect(emailSender.sent[0].from).toBe(NOTIFICATION_EMAIL_FROM);
    expect(emailSender.sent[0].subject).toBe('Fraud alert: CASE_ASSIGNED');
    expect(emailSender.sent[0].text).toBe('You have a new CASE_ASSIGNED alert.');
    expect(emailSender.sent[0].subject).not.toMatch(/Alerta de fraude/i);
    expect(emailSender.sent[0].text).not.toMatch(/Tenés una nueva alerta/i);
  });

  it('keeps English copy for a second supported alert type', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input({ alertType: createAlertType('CRITICAL_RISK') }));

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].subject).toBe('Fraud alert: CRITICAL_RISK');
    expect(emailSender.sent[0].text).toBe('You have a new CRITICAL_RISK alert.');
    expect(emailSender.sent[0].subject).not.toMatch(/Alerta de fraude/i);
    expect(emailSender.sent[0].text).not.toMatch(/Tenés una nueva alerta/i);
  });

  it('does not invoke EmailSender when the recipient user is missing', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input({ recipientUserId: oid('ghost-user') as NotificationUserId }));

    expect(emailSender.sent).toHaveLength(0);
  });

  it('invokes EmailSender exactly once when the recipient user exists', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input());

    expect(emailSender.sent).toHaveLength(1);
  });

  it('uses body only when context is empty', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input({ context: {} }));

    expect(emailSender.sent[0].text).toBe('You have a new CASE_ASSIGNED alert.');
  });

  it('appends key: value context lines after a blank line when context is nonempty', async () => {
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(
      emailSender,
      asMongoFactory(users),
      NOTIFICATION_EMAIL_FROM,
    );

    await sender.send(input({ context: { caseId: 'c-1', amount: 42 } }));

    expect(emailSender.sent[0].text).toBe(
      'You have a new CASE_ASSIGNED alert.\n\ncaseId: c-1\namount: 42',
    );
  });

  it('uses the provided from address as the password-reset fallback when that is what composition passed', async () => {
    const fallbackFrom = 'noreply@example.com';
    const emailSender = new FakeEmailSender();
    const users = new InMemoryUserRepositoryFactory();
    await seedFoundUser(users);
    const sender = createNotificationEmailSenderAdapter(emailSender, asMongoFactory(users), fallbackFrom);

    await sender.send(input());

    expect(emailSender.sent[0].from).toBe(fallbackFrom);
  });
});
