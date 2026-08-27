import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CustomerWebhookSubscriptionId = Brand<string, 'CustomerWebhookSubscriptionId'>;

/** Validates a raw id coming from persistence, DTOs, or route params. */
export function createCustomerWebhookSubscriptionId(value: string): CustomerWebhookSubscriptionId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation(
      'CustomerWebhookSubscriptionId must be a 24-character hexadecimal ObjectId',
      { value },
    );
  }
  return brand<string, 'CustomerWebhookSubscriptionId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateCustomerWebhookSubscriptionId(): CustomerWebhookSubscriptionId {
  return brand<string, 'CustomerWebhookSubscriptionId'>(generateObjectIdHex());
}
