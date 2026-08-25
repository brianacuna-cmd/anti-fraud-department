/**
 * Minimal DER for RFC 3161: just enough to build a `TimeStampReq` and read a
 * `TimeStampResp`.
 *
 * It is written by hand instead of pulling in a PKI library because the
 * surface needed is tiny and fully specified —four types and a walk— while
 * any complete ASN.1 package dumps thousands of lines onto the path of a
 * piece of evidence that may end up in court. Here the whole thing can be
 * read in five minutes.
 */

export const TAG_BOOLEAN = 0x01;
export const TAG_INTEGER = 0x02;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_GENERALIZED_TIME = 0x18;
export const TAG_SEQUENCE = 0x30;
export const TAG_CONTEXT_0 = 0xa0;

/** DER length: short (<128) or long (0x80 | byte count, big-endian). */
export function encodeLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function encodeTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

export function encodeSequence(...parts: Buffer[]): Buffer {
  return encodeTlv(TAG_SEQUENCE, Buffer.concat(parts));
}

/**
 * INTEGER from raw bytes.
 *
 * 0x00 is prepended when the high bit is set: DER encodes integers in two's
 * complement, so without that byte a random nonce that starts with 0x80 or
 * higher would be transmitted as a negative number and some TSAs reject the
 * request.
 */
export function encodeInteger(value: Buffer): Buffer {
  let bytes = value;
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00 && (bytes[start + 1]! & 0x80) === 0) {
    start += 1;
  }
  bytes = bytes.subarray(start);
  if ((bytes[0]! & 0x80) !== 0) {
    bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  }
  return encodeTlv(TAG_INTEGER, bytes);
}

export function encodeSmallInteger(value: number): Buffer {
  return encodeInteger(Buffer.from([value]));
}

export function encodeBoolean(value: boolean): Buffer {
  return encodeTlv(TAG_BOOLEAN, Buffer.from([value ? 0xff : 0x00]));
}

export function encodeNull(): Buffer {
  return encodeTlv(TAG_NULL, Buffer.alloc(0));
}

/** SHA-256 OID (2.16.840.1.101.3.4.2.1), already encoded. */
export const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

export interface Tlv {
  readonly tag: number;
  /** Offset of the first content byte. */
  readonly contentStart: number;
  readonly length: number;
  /** Offset of the first byte AFTER this TLV. */
  readonly end: number;
}

export function readTlv(buffer: Buffer, offset: number): Tlv {
  if (offset + 2 > buffer.length) {
    throw new Error('truncated DER: no room for tag + length');
  }
  const tag = buffer[offset]!;
  const first = buffer[offset + 1]!;

  if ((first & 0x80) === 0) {
    const end = offset + 2 + first;
    // The short form is validated too: Node's `subarray` silently clips when
    // the range overruns, so without this check a truncated reply would be
    // read as valid but incomplete content — a half-parsed seal instead of
    // an error.
    if (end > buffer.length) {
      throw new Error('truncated DER: content runs past the buffer');
    }
    return { tag, contentStart: offset + 2, length: first, end };
  }

  const lengthBytes = first & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 4) {
    throw new Error(`unsupported DER length form (${lengthBytes} bytes)`);
  }
  if (offset + 2 + lengthBytes > buffer.length) {
    throw new Error('truncated DER: no room for long-form length');
  }
  let length = 0;
  for (let i = 0; i < lengthBytes; i += 1) {
    length = (length << 8) | buffer[offset + 2 + i]!;
  }
  const contentStart = offset + 2 + lengthBytes;
  if (contentStart + length > buffer.length) {
    throw new Error('truncated DER: content runs past the buffer');
  }
  return { tag, contentStart, length, end: contentStart + length };
}

export function expectTag(buffer: Buffer, offset: number, tag: number, what: string): Tlv {
  const tlv = readTlv(buffer, offset);
  if (tlv.tag !== tag) {
    throw new Error(`expected ${what} (tag 0x${tag.toString(16)}), got 0x${tlv.tag.toString(16)}`);
  }
  return tlv;
}

export function contentOf(buffer: Buffer, tlv: Tlv): Buffer {
  return buffer.subarray(tlv.contentStart, tlv.end);
}

/** Small DER integer (status, version). Not for long serials. */
export function readSmallInteger(buffer: Buffer, tlv: Tlv): number {
  const bytes = contentOf(buffer, tlv);
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
  }
  return value;
}

/**
 * GeneralizedTime -> Date. Format `YYYYMMDDHHMMSS[.fff]Z`.
 *
 * RFC 3161 requires `genTime` in UTC with the Z, so time-zone offsets are not
 * contemplated: a TSA that sent local time would be out of spec, and
 * accepting it silently would put a seal with the wrong time on the case.
 */
export function parseGeneralizedTime(raw: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3})\d*)?Z$/.exec(raw);
  if (match === null) {
    throw new Error(`unsupported GeneralizedTime: ${raw}`);
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  const millis = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0'));
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millis,
    ),
  );
}
