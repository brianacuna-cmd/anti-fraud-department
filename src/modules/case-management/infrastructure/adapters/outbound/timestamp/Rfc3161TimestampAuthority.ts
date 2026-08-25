import { randomBytes } from 'node:crypto';
import type { EvidenceTimestamp } from '../../../../domain/model/aggregates/Evidence.js';
import type { TimestampAuthority } from '../../../../domain/ports/TimestampAuthority.js';
import { fromDate } from '../../../../../../shared/time/Instant.js';
import type { Tlv } from './der.js';
import {
  OID_SHA256,
  TAG_CONTEXT_0,
  TAG_GENERALIZED_TIME,
  TAG_INTEGER,
  TAG_OCTET_STRING,
  TAG_OID,
  TAG_SEQUENCE,
  contentOf,
  encodeBoolean,
  encodeInteger,
  encodeNull,
  encodeSequence,
  encodeSmallInteger,
  encodeTlv,
  expectTag,
  parseGeneralizedTime,
  readSmallInteger,
  readTlv,
} from './der.js';

export interface Rfc3161Options {
  /** Endpoint HTTP de la TSA. */
  readonly url: string;
  /** Nombre con el que queda firmado el sello en el expediente. */
  readonly authorityName: string;
  readonly timeoutMs?: number;
  /**
   * `true` pide que la TSA incluya su certificado en el token. Por defecto sí:
   * un sello sin la cadena solo se puede verificar mientras alguien conserve
   * el certificado por otro lado, y un expediente tiene que poder verificarse
   * solo dentro de diez años.
   */
  readonly requestCertificate?: boolean;
  /** Credenciales HTTP básicas, si la TSA las exige. */
  readonly authorizationHeader?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** PKIStatus (RFC 3161 §2.4.2). Solo 0 y 1 entregan token. */
const PKI_STATUS_GRANTED = 0;
const PKI_STATUS_GRANTED_WITH_MODS = 1;

/**
 * `TimestampAuthority` real contra una TSA RFC 3161 por HTTP.
 *
 * Sella el SHA-256 que `RegisterEvidence` ya calculó sobre los bytes. Lo que
 * viaja es el hash, nunca el fichero: la TSA no debe ver el contenido de una
 * prueba, y ese es justamente el diseño del protocolo.
 *
 * El sello se guarda en base64 tal cual llega. Es un `TimeStampToken` CMS
 * completo —con la cadena de certificados dentro si se pidió— y es lo único
 * que permite a un tercero demostrar dentro de diez años que ese hash existía
 * en esa fecha. Guardar solo la hora extraída sería tirar la prueba y quedarse
 * con nuestra palabra.
 */
export class Rfc3161TimestampAuthority implements TimestampAuthority {
  private readonly timeoutMs: number;
  private readonly requestCertificate: boolean;

  constructor(private readonly options: Rfc3161Options) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestCertificate = options.requestCertificate ?? true;
  }

  async requestTimestamp(sha256Hex: string): Promise<EvidenceTimestamp | null> {
    const request = buildTimeStampReq(sha256Hex, this.requestCertificate);
    const response = await this.post(request);
    const { token, genTime } = parseTimeStampResp(response);

    return {
      token: token.toString('base64'),
      authority: this.options.authorityName,
      timestampedAt: fromDate(genTime),
    };
  }

  private async post(body: Buffer): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/timestamp-query',
          Accept: 'application/timestamp-reply',
          ...(this.options.authorizationHeader === undefined
            ? {}
            : { Authorization: this.options.authorizationHeader }),
        },
        body: new Uint8Array(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`TSA responded ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * TimeStampReq ::= SEQUENCE {
 *   version INTEGER (1),
 *   messageImprint MessageImprint,
 *   nonce INTEGER OPTIONAL,
 *   certReq BOOLEAN DEFAULT FALSE }
 *
 * El nonce es aleatorio y de 8 bytes: es lo que ata la respuesta a ESTA
 * petición. Sin él, alguien que pueda interceptar la conexión puede devolver
 * un sello viejo y válido de otro documento, y el expediente se quedaría con
 * una fecha que nadie pidió.
 */
export function buildTimeStampReq(sha256Hex: string, requestCertificate: boolean): Buffer {
  const digest = Buffer.from(sha256Hex, 'hex');
  if (digest.length !== 32) {
    throw new Error(`expected a 32-byte SHA-256 digest, got ${digest.length}`);
  }

  const messageImprint = encodeSequence(
    encodeSequence(OID_SHA256, encodeNull()),
    encodeTlv(TAG_OCTET_STRING, digest),
  );

  return encodeSequence(
    encodeSmallInteger(1),
    messageImprint,
    encodeInteger(randomBytes(8)),
    encodeBoolean(requestCertificate),
  );
}

export interface ParsedTimeStampResp {
  readonly token: Buffer;
  readonly genTime: Date;
}

/**
 * TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }
 *
 * Un `status` distinto de granted/grantedWithMods lanza: una TSA que rechaza
 * no deja evidencia sin sellar "por defecto", deja un fallo que alguien tiene
 * que ver.
 */
export function parseTimeStampResp(response: Buffer): ParsedTimeStampResp {
  const outer = expectTag(response, 0, TAG_SEQUENCE, 'TimeStampResp');
  const statusInfo = expectTag(response, outer.contentStart, TAG_SEQUENCE, 'PKIStatusInfo');
  const statusTlv = expectTag(response, statusInfo.contentStart, TAG_INTEGER, 'PKIStatus');
  const status = readSmallInteger(response, statusTlv);

  if (status !== PKI_STATUS_GRANTED && status !== PKI_STATUS_GRANTED_WITH_MODS) {
    throw new Error(`TSA rejected the request (PKIStatus ${status})`);
  }
  if (statusInfo.end >= outer.end) {
    throw new Error('TSA granted the request but returned no timeStampToken');
  }

  const tokenTlv = readTlv(response, statusInfo.end);
  const token = response.subarray(statusInfo.end, tokenTlv.end);
  return { token, genTime: extractGenTime(response, tokenTlv) };
}

/**
 * Saca el `genTime` del token recorriendo la estructura, no buscando el primer
 * GeneralizedTime que aparezca.
 *
 * El atajo de escanear el buffer es tentador y está mal: si se pidió el
 * certificado, dentro del token viajan las fechas de validez del certificado
 * de la TSA, que también son GeneralizedTime, y el escaneo puede devolver la
 * fecha en que caduca un certificado como si fuera la hora del sello.
 *
 * ContentInfo -> [0] -> SignedData -> encapContentInfo -> [0] -> OCTET STRING
 * -> TSTInfo -> genTime.
 */
function extractGenTime(buffer: Buffer, tokenTlv: Tlv): Date {
  // ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT ANY }
  const contentType = expectTag(buffer, tokenTlv.contentStart, TAG_OID, 'ContentInfo.contentType');
  const explicit = expectTag(buffer, contentType.end, TAG_CONTEXT_0, 'ContentInfo.content');
  const signedData = expectTag(buffer, explicit.contentStart, TAG_SEQUENCE, 'SignedData');

  // SignedData ::= SEQUENCE { version, digestAlgorithms SET, encapContentInfo, ... }
  const version = expectTag(buffer, signedData.contentStart, TAG_INTEGER, 'SignedData.version');
  const digestAlgorithms = readTlv(buffer, version.end);
  const encapContentInfo = expectTag(buffer, digestAlgorithms.end, TAG_SEQUENCE, 'EncapsulatedContentInfo');

  // EncapsulatedContentInfo ::= SEQUENCE { eContentType OID, eContent [0] OCTET STRING }
  const eContentType = expectTag(buffer, encapContentInfo.contentStart, TAG_OID, 'eContentType');
  const eContentWrapper = expectTag(buffer, eContentType.end, TAG_CONTEXT_0, 'eContent');
  const eContent = expectTag(buffer, eContentWrapper.contentStart, TAG_OCTET_STRING, 'eContent bytes');

  // TSTInfo ::= SEQUENCE { version, policy OID, messageImprint, serialNumber, genTime, ... }
  const tstInfo = expectTag(buffer, eContent.contentStart, TAG_SEQUENCE, 'TSTInfo');
  const tstVersion = expectTag(buffer, tstInfo.contentStart, TAG_INTEGER, 'TSTInfo.version');
  const policy = expectTag(buffer, tstVersion.end, TAG_OID, 'TSTInfo.policy');
  const imprint = expectTag(buffer, policy.end, TAG_SEQUENCE, 'TSTInfo.messageImprint');
  const serialNumber = expectTag(buffer, imprint.end, TAG_INTEGER, 'TSTInfo.serialNumber');
  const genTime = expectTag(buffer, serialNumber.end, TAG_GENERALIZED_TIME, 'TSTInfo.genTime');

  return parseGeneralizedTime(contentOf(buffer, genTime).toString('ascii'));
}
