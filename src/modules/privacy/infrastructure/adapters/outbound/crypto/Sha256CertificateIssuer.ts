import { createHash } from 'node:crypto';
import type {
  CertificateInput,
  CertificateIssuer,
  IssuedCertificate,
} from '../../../../domain/ports/CertificateIssuer.js';

const RESOLUTION_TEXT: Record<string, string> = {
  FULFILLED: 'La solicitud fue atendida en su totalidad.',
  PARTIALLY_FULFILLED:
    'La solicitud fue atendida parcialmente. Parte de los registros se conserva por una obligación legal de retención.',
  REJECTED: 'La solicitud fue denegada.',
};

/**
 * Renders the constancia and fingerprints it with SHA-256.
 *
 * The document is plain text, in Spanish, and readable by the person who
 * receives it — not JSON. A constancia exists to be handed to a data subject
 * and, if it comes to it, shown to a regulator; a payload only a program can
 * read fails at the one job it has.
 *
 * The hash covers the exact bytes of `document`. Rendering it any other way
 * later would produce a different hash and, correctly, fail to match.
 */
export class Sha256CertificateIssuer implements CertificateIssuer {
  issue(input: CertificateInput): IssuedCertificate {
    const document = [
      'CONSTANCIA DE ATENCIÓN A SOLICITUD DE DERECHOS DEL TITULAR',
      '',
      `Solicitud:    ${input.requestId}`,
      `Titular:      ${input.subjectEmail}`,
      `Derecho:      ${input.type}`,
      `Resolución:   ${input.resolution}`,
      `Fecha:        ${input.resolvedAtIso}`,
      '',
      RESOLUTION_TEXT[input.resolution] ?? '',
      '',
      'Motivación:',
      input.note.trim(),
      '',
    ].join('\n');

    return {
      document,
      sha256: createHash('sha256').update(document, 'utf8').digest('hex'),
    };
  }
}
