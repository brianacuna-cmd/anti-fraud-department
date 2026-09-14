import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/RiskAssessmentError.js';

export type PaymentActivityId = Brand<string, 'PaymentActivityId'>;

/** Validates a raw id coming from persistence. */
export function createPaymentActivityId(value: string): PaymentActivityId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('PaymentActivityId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'PaymentActivityId'>(value);
}

export function generatePaymentActivityId(): PaymentActivityId {
  return brand<string, 'PaymentActivityId'>(generateObjectIdHex());
}
