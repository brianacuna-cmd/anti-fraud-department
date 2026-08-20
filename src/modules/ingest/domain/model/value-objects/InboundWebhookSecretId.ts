import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IngestError.js';

export type InboundWebhookSecretId = Brand<string, 'InboundWebhookSecretId'>;

export function createInboundWebhookSecretId(value: string): InboundWebhookSecretId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('InboundWebhookSecretId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'InboundWebhookSecretId'>(value);
}

export function generateInboundWebhookSecretId(): InboundWebhookSecretId {
  return brand<string, 'InboundWebhookSecretId'>(generateObjectIdHex());
}
