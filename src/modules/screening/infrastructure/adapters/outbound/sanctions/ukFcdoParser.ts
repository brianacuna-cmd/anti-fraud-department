import type { SanctionedParty } from '../../../../domain/ports/SanctionListFeed.js';
import type { XmlNode } from './xmlRecords.js';
import { childText, collectRecords, descendantsNamed, uniqueNonEmpty } from './xmlRecords.js';

/** Given names come first; `Name6` is the surname, or the whole name of an entity. */
const NAME_PARTS = ['Name1', 'Name2', 'Name3', 'Name4', 'Name5', 'Name6'] as const;

/**
 * A business registration number is kept only when it looks like one.
 * The list sometimes stores prose in that field — "(УНН/ИНН): 190950894
 * (Belarus), 7704734000/770301001 (Russia)" — and a document is matched
 * exactly, so prose can never match anything; it would only take up space.
 */
const IDENTIFIER_SHAPE = /^[A-Z0-9][A-Z0-9 ./-]{2,39}$/i;

function fullName(name: XmlNode): string {
  return NAME_PARTS.map((part) => childText(name, part))
    .filter((part) => part.length > 0)
    .join(' ');
}

/**
 * `NameType` is inconsistently cased in the published file ("Primary
 * Name", "Primary name", "ALias"…), so it is compared lowercased. Primary
 * name variations are not the primary name.
 */
function isPrimary(name: XmlNode): boolean {
  return childText(name, 'NameType').toLowerCase() === 'primary name';
}

function isLowQuality(name: XmlNode): boolean {
  return childText(name, 'AliasStrength').toLowerCase().startsWith('low quality');
}

function texts(designation: XmlNode, tag: string): string[] {
  return descendantsNamed(designation, tag).map((node) => node.text.trim());
}

function firstCountry(designation: XmlNode): string | null {
  const countries = [...texts(designation, 'Nationality'), ...texts(designation, 'AddressCountry')];
  return countries.find((country) => country.length > 0) ?? null;
}

/** One `Designation` → one party. Low quality a.k.a.s are dropped, as with OFAC's weak ones. */
export function toUkParty(designation: XmlNode): SanctionedParty | null {
  const uid = childText(designation, 'UniqueID');
  if (uid.length === 0) return null;
  const names = descendantsNamed(designation, 'Name')
    .filter((name) => !isLowQuality(name))
    .sort((a, b) => Number(isPrimary(b)) - Number(isPrimary(a)))
    .map(fullName);
  const documents = [
    ...texts(designation, 'PassportNumber'),
    ...texts(designation, 'NationalIdentifierNumber'),
    ...texts(designation, 'BusinessRegistrationNumber').filter((value) => IDENTIFIER_SHAPE.test(value)),
  ];
  return {
    uid,
    entryType: childText(designation, 'IndividualEntityShip') === 'Individual' ? 'PERSON' : 'ORGANIZATION',
    names: uniqueNonEmpty(names),
    documents: uniqueNonEmpty(documents),
    walletAddresses: [],
    country: firstCountry(designation),
  };
}

export function parseUkFcdo(chunks: AsyncIterable<string>): Promise<SanctionedParty[]> {
  return collectRecords(chunks, 'Designation', toUkParty);
}
