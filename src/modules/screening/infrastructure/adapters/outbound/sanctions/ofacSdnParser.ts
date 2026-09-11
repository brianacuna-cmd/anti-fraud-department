import type { SanctionedParty } from '../../../../domain/ports/SanctionListFeed.js';
import type { XmlNode } from './xmlRecords.js';
import { childText, collectRecords, descendantsNamed, uniqueNonEmpty } from './xmlRecords.js';

const WALLET_ID_PREFIX = 'Digital Currency Address - ';

/**
 * The OFAC `idType` values that identify the party itself.
 *
 * An explicit list rather than "everything in `idList`": about half of that
 * list is not an identifier at all — "Gender", "Website", "Secondary
 * sanctions risk:", vessel build years, aircraft models. Indexed as
 * documents they would sit in the exact-match index as values like "Male",
 * and every male customer presenting a document would collide with them.
 * Taken from the SDN.XML published 2026-09-10; a new identifier type OFAC
 * starts using needs adding here to be screened.
 */
export const OFAC_DOCUMENT_ID_TYPES: ReadonlySet<string> = new Set([
  'Passport',
  'Diplomatic Passport',
  'British National Overseas Passport',
  'National ID No.',
  'National Foreign ID Number',
  'Personal ID Card',
  'Identification Number',
  'Numero de Identidad',
  'Tarjeta de Identidad',
  'Citizen\'s Card Number',
  'Turkish Identification Number',
  'Kenyan ID No.',
  'Moroccan Personal ID No.',
  'Bosnian Personal ID No.',
  'Tazkira National ID Card',
  'UAE Identification',
  'CNP (Personal Numerical Code)',
  'Travel Document Number',
  'Residency Number',
  'Birth Certificate Number',
  'Driver\'s License No.',
  'Electoral Registry No.',
  'Credencial electoral',
  'I.F.E.',
  'SSN',
  'Tax ID No.',
  'Cedula No.',
  'C.U.R.P.',
  'R.F.C.',
  'RFC',
  'NIT #',
  'RUC #',
  'RIF #',
  'D.N.I.',
  'C.I.N.',
  'C.U.I.',
  'C.U.I.T.',
  'N.I.F.',
  'N.I.E.',
  'C.I.F.',
  'Italian Fiscal Code',
  'Fiscal Code',
  'V.A.T. Number',
  'US FEIN',
  'Registration Number',
  'Registration ID',
  'Business Registration Number',
  'Business Registration Document #',
  'Business Number',
  'Company Number',
  'UK Company Number',
  'Commercial Registry Number',
  'Chamber of Commerce Number',
  'C.R. No.',
  'Folio Mercantil No.',
  'Matricula Mercantil No',
  'Enterprise Number',
  'Legal Entity Number',
  'Unified Social Credit Code (USCC)',
  'United Social Credit Code Certificate (USCCC)',
  'Trade License No.',
  'Certificate of Incorporation Number',
  'Public Registration Number',
  'Central Registration System Number',
]);

function fullName(node: XmlNode): string {
  return [childText(node, 'firstName'), childText(node, 'lastName')].filter((part) => part.length > 0).join(' ');
}

/** Nationality/citizenship first — for a person it is the meaningful country; an address is where they were seen. */
function firstCountry(entry: XmlNode): string | null {
  const candidates = [
    ...descendantsNamed(entry, 'nationality'),
    ...descendantsNamed(entry, 'citizenship'),
    ...descendantsNamed(entry, 'address'),
  ].map((node) => childText(node, 'country'));
  return candidates.find((country) => country.length > 0) ?? null;
}

function idNumbers(entry: XmlNode, accepts: (idType: string) => boolean): string[] {
  return descendantsNamed(entry, 'id')
    .filter((id) => accepts(childText(id, 'idType')))
    .map((id) => childText(id, 'idNumber'));
}

/**
 * One `sdnEntry` → one party. Weak a.k.a.s are dropped: OFAC itself flags
 * them as low quality ("weak") and screening them by name is the textbook
 * source of false positives; strong a.k.a.s and the primary name are kept.
 */
export function toOfacParty(entry: XmlNode): SanctionedParty | null {
  const uid = childText(entry, 'uid');
  if (uid.length === 0) return null;
  const aliases = descendantsNamed(entry, 'aka')
    .filter((aka) => childText(aka, 'category').toLowerCase() !== 'weak')
    .map(fullName);
  return {
    uid,
    entryType: childText(entry, 'sdnType') === 'Individual' ? 'PERSON' : 'ORGANIZATION',
    names: uniqueNonEmpty([fullName(entry), ...aliases]),
    documents: uniqueNonEmpty(idNumbers(entry, (idType) => OFAC_DOCUMENT_ID_TYPES.has(idType))),
    walletAddresses: uniqueNonEmpty(idNumbers(entry, (idType) => idType.startsWith(WALLET_ID_PREFIX))),
    country: firstCountry(entry),
  };
}

export function parseOfacSdn(chunks: AsyncIterable<string>): Promise<SanctionedParty[]> {
  return collectRecords(chunks, 'sdnEntry', toOfacParty);
}
