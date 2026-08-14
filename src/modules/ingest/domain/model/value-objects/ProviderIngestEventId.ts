import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/IngestError.js';

export type ProviderIngestEventId = Brand<string, 'ProviderIngestEventId'>;

export function createProviderIngestEventId(value: string): ProviderIngestEventId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('ProviderIngestEventId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'ProviderIngestEventId'>(value);
}

export function generateProviderIngestEventId(): ProviderIngestEventId {
  return brand<string, 'ProviderIngestEventId'>(generateObjectIdHex());
}
