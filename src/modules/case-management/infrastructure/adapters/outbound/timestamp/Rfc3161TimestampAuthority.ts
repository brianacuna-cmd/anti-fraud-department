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
  /** HTTP endpoint of the TSA. */
  readonly url: string;
  /** Name under which the seal is recorded on the case. */
  readonly authorityName: string;
  readonly timeoutMs?: number;
  /**
   * `true` asks the TSA to include its certificate in the token. Default yes:
   * a seal without the chain can only be verified while someone else still
   * holds the certificate, and a case has to remain verifiable on its own
   * ten years from now.
   */
  readonly requestCertificate?: boolean;
  /** HTTP basic credentials, if the TSA requires them. */
  readonly authorizationHeader?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** PKIStatus (RFC 3161 §2.4.2). Only 0 and 1 deliver a token. */
const PKI_STATUS_GRANTED = 0;
const PKI_STATUS_GRANTED_WITH_MODS = 1;

/**
 * Real `TimestampAuthority` against an RFC 3161 TSA over HTTP.
 *
 * Seals the SHA-256 that `RegisterEvidence` already computed over the bytes.
 * What travels is the hash, never the file: the TSA must not see the content
 * of a piece of evidence, and that is exactly the design of the protocol.
 *
 * The seal is stored in base64 as it arrives. It is a complete CMS
 * `TimeStampToken` —with the certificate chain inside if it was requested—
 * and it is the only thing that lets a third party prove ten years from now
 * that that hash existed on that date. Saving only the extracted time would
 * be throwing away the proof and keeping our word.
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
 * The nonce is random and 8 bytes: that is what binds the reply to THIS
 * request. Without it, someone who can intercept the connection can return
 * an old, valid seal from another document, and the case would keep a date
 * nobody asked for.
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
 * A `status` other than granted/grantedWithMods throws: a TSA that rejects
 * does not leave evidence unstamped "by default", it leaves a failure someone
 * has to see.
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
 * Pulls `genTime` from the token by walking the structure, not by hunting
 * for the first GeneralizedTime that appears.
 *
 * The shortcut of scanning the buffer is tempting and wrong: if the
 * certificate was requested, the TSA certificate validity dates travel
 * inside the token, and those are GeneralizedTime too, so a scan can
 * return the date a certificate expires as if it were the seal time.
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
