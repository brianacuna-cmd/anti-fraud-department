import type { SanctionedParty } from '../../../../domain/ports/SanctionListFeed.js';
import type { XmlNode } from './xmlRecords.js';
import { childrenNamed, collectRecords, uniqueNonEmpty } from './xmlRecords.js';

/**
 * EU `identificationTypeCode` values kept as documents. Left out: `other`
 * (free text), `swiftbic` (a bank, not the party), `imo` (a ship hull
 * number), `unssn`, `travelcardid` and `birthcert`, none of which a
 * customer presents at onboarding.
 */
export const EU_DOCUMENT_TYPE_CODES: ReadonlySet<string> = new Set([
  'passport',
  'id',
  'nationcert',
  'fiscalcode',
  'taxid',
  'regnumber',
  'ssn',
  'drivinglicence',
  'residentperm',
  'euvat',
  'tradelic',
  'electionid',
]);

/** "00" is the list's own code for an unknown country. */
const UNKNOWN_COUNTRY = '00';

function attribute(node: XmlNode, name: string): string {
  return node.attributes[name]?.trim() ?? '';
}

function documentNumber(identification: XmlNode): string {
  const number = attribute(identification, 'number');
  return number.length > 0 ? number : attribute(identification, 'latinNumber');
}

function firstCountry(entity: XmlNode): string | null {
  const codes = [...childrenNamed(entity, 'citizenship'), ...childrenNamed(entity, 'address')]
    .map((node) => attribute(node, 'countryIso2Code'))
    .filter((code) => code.length > 0 && code !== UNKNOWN_COUNTRY);
  return codes[0] ?? null;
}

/** One `sanctionEntity` → one party. */
export function toEuParty(entity: XmlNode): SanctionedParty | null {
  const uid = attribute(entity, 'logicalId');
  if (uid.length === 0) return null;
  const subjectType = childrenNamed(entity, 'subjectType')[0];
  const names = childrenNamed(entity, 'nameAlias')
    .filter((alias) => attribute(alias, 'strong') !== 'false')
    .map((alias) => attribute(alias, 'wholeName'));
  const documents = childrenNamed(entity, 'identification')
    .filter((identification) => EU_DOCUMENT_TYPE_CODES.has(attribute(identification, 'identificationTypeCode')))
    .map(documentNumber);
  return {
    uid,
    entryType: subjectType !== undefined && attribute(subjectType, 'code') === 'person' ? 'PERSON' : 'ORGANIZATION',
    names: uniqueNonEmpty(names),
    documents: uniqueNonEmpty(documents),
    // The EU list carries wallet addresses only inside free-text remarks.
    walletAddresses: [],
    country: firstCountry(entity),
  };
}

export function parseEuFsf(chunks: AsyncIterable<string>): Promise<SanctionedParty[]> {
  return collectRecords(chunks, 'sanctionEntity', toEuParty);
}
