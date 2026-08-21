/**
 * DER mínimo para RFC 3161: lo justo para armar un `TimeStampReq` y leer un
 * `TimeStampResp`.
 *
 * Se escribe a mano en vez de traer una librería de PKI porque la superficie
 * que hace falta es diminuta y perfectamente especificada —cuatro tipos y un
 * recorrido— mientras que cualquier paquete de ASN.1 completo mete miles de
 * líneas en el camino de una pieza de evidencia que puede acabar en un
 * juzgado. Aquí se lee entero en cinco minutos.
 */

export const TAG_BOOLEAN = 0x01;
export const TAG_INTEGER = 0x02;
export const TAG_OCTET_STRING = 0x04;
export const TAG_NULL = 0x05;
export const TAG_OID = 0x06;
export const TAG_GENERALIZED_TIME = 0x18;
export const TAG_SEQUENCE = 0x30;
export const TAG_CONTEXT_0 = 0xa0;

/** Longitud DER: corta (<128) o larga (0x80 | nº de bytes, big-endian). */
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
 * INTEGER a partir de bytes crudos.
 *
 * Se antepone 0x00 cuando el bit alto está puesto: DER codifica enteros en
 * complemento a dos, así que sin ese byte un nonce aleatorio que empiece por
 * 0x80 o más se transmitiría como número negativo y algunas TSA rechazan la
 * petición.
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

/** OID de SHA-256 (2.16.840.1.101.3.4.2.1), ya codificado. */
export const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

export interface Tlv {
  readonly tag: number;
  /** Offset del primer byte del contenido. */
  readonly contentStart: number;
  readonly length: number;
  /** Offset del primer byte DESPUÉS de este TLV. */
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
    // La forma corta tambien se valida: `subarray` de Node recorta en silencio
    // cuando el rango se sale, asi que sin esta comprobacion una respuesta
    // truncada se leeria como contenido valido pero incompleto — un sello
    // parseado a medias en vez de un error.
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

/** Entero DER pequeño (status, versión). No sirve para seriales largos. */
export function readSmallInteger(buffer: Buffer, tlv: Tlv): number {
  const bytes = contentOf(buffer, tlv);
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
  }
  return value;
}

/**
 * GeneralizedTime -> Date. Formato `YYYYMMDDHHMMSS[.fff]Z`.
 *
 * RFC 3161 exige que `genTime` venga en UTC con la Z, así que no se contemplan
 * desplazamientos horarios: una TSA que mandara hora local estaría fuera de
 * especificación y aceptarla en silencio pondría en el expediente un sello con
 * la hora equivocada.
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
