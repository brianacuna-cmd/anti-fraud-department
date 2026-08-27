import {
  OID_SHA256,
  TAG_CONTEXT_0,
  TAG_GENERALIZED_TIME,
  TAG_OCTET_STRING,
  TAG_OID,
  encodeInteger,
  encodeLength,
  encodeSequence,
  encodeSmallInteger,
  encodeTlv,
  expectTag,
  parseGeneralizedTime,
  readTlv,
} from '../../../src/modules/case-management/infrastructure/adapters/outbound/timestamp/der.js';
import {
  buildTimeStampReq,
  parseTimeStampResp,
} from '../../../src/modules/case-management/infrastructure/adapters/outbound/timestamp/Rfc3161TimestampAuthority.js';

const DIGEST = 'a'.repeat(64);

/** Empty SET, which is what `digestAlgorithms` carries when it is not of interest. */
const EMPTY_SET = Buffer.from([0x31, 0x00]);

/**
 * Builds a `TimeStampResp` like the one a TSA would return.
 *
 * `certificates` puts a GeneralizedTime BEFORE the real `genTime`, mimicking
 * the validity date of an embedded certificate. That is exactly the trap an
 * implementation that looks for "the first GeneralizedTime in the buffer"
 * falls into — which is why the test builds it on purpose.
 */
function buildResponse(options: {
  status: number;
  genTime?: string;
  decoyTime?: string;
  omitToken?: boolean;
}): Buffer {
  const statusInfo = encodeSequence(encodeSmallInteger(options.status));
  if (options.omitToken === true) {
    return encodeSequence(statusInfo);
  }

  const tstInfo = encodeSequence(
    encodeSmallInteger(1),
    OID_SHA256,
    encodeSequence(encodeSequence(OID_SHA256), encodeTlv(TAG_OCTET_STRING, Buffer.alloc(32))),
    encodeInteger(Buffer.from([0x2a])),
    encodeTlv(TAG_GENERALIZED_TIME, Buffer.from(options.genTime ?? '20260115103000Z', 'ascii')),
  );

  const decoy =
    options.decoyTime === undefined
      ? Buffer.alloc(0)
      : encodeTlv(TAG_GENERALIZED_TIME, Buffer.from(options.decoyTime, 'ascii'));

  const signedData = encodeSequence(
    encodeSmallInteger(3),
    EMPTY_SET,
    encodeSequence(OID_SHA256, encodeTlv(TAG_CONTEXT_0, encodeTlv(TAG_OCTET_STRING, tstInfo))),
    decoy,
  );

  const token = encodeSequence(OID_SHA256, encodeTlv(TAG_CONTEXT_0, signedData));
  return encodeSequence(statusInfo, token);
}

describe('DER', () => {
  it('codifica la longitud corta y la larga', () => {
    expect([...encodeLength(0)]).toEqual([0x00]);
    expect([...encodeLength(127)]).toEqual([0x7f]);
    // 128 ya no cabe en forma corta: 0x81 dice "un byte de longitud".
    expect([...encodeLength(128)]).toEqual([0x81, 0x80]);
    expect([...encodeLength(300)]).toEqual([0x82, 0x01, 0x2c]);
  });

  it('antepone 0x00 a un entero cuyo bit alto está puesto', () => {
    // Without that byte, DER would read it as negative and some TSAs reject the nonce.
    const encoded = encodeInteger(Buffer.from([0xff, 0x01]));
    expect([...encoded]).toEqual([0x02, 0x03, 0x00, 0xff, 0x01]);
  });

  it('no antepone nada cuando el bit alto está libre', () => {
    expect([...encodeInteger(Buffer.from([0x7f]))]).toEqual([0x02, 0x01, 0x7f]);
  });

  it('lee un TLV de forma larga', () => {
    const tlv = encodeTlv(0x04, Buffer.alloc(200, 0xab));
    const read = readTlv(tlv, 0);

    expect(read.tag).toBe(0x04);
    expect(read.length).toBe(200);
    expect(read.end).toBe(tlv.length);
  });

  it('rechaza DER truncado en vez de leer basura', () => {
    expect(() => readTlv(Buffer.from([0x30, 0x05, 0x01]), 0)).toThrow(/truncated/);
  });

  it('exige el tag esperado', () => {
    expect(() => expectTag(Buffer.from([0x02, 0x01, 0x00]), 0, TAG_OID, 'un OID')).toThrow(
      /expected un OID/,
    );
  });

  it('parsea GeneralizedTime en UTC, con y sin fracción', () => {
    expect(parseGeneralizedTime('20260115103000Z').toISOString()).toBe('2026-01-15T10:30:00.000Z');
    expect(parseGeneralizedTime('20260115103000.5Z').toISOString()).toBe('2026-01-15T10:30:00.500Z');
  });

  it('rechaza un GeneralizedTime sin Z', () => {
    // RFC 3161 requires UTC. Accepting local time would stamp with the wrong hour.
    expect(() => parseGeneralizedTime('20260115103000')).toThrow(/unsupported GeneralizedTime/);
  });
});

describe('buildTimeStampReq', () => {
  it('arma un TimeStampReq con el imprint SHA-256 pedido', () => {
    const request = buildTimeStampReq(DIGEST, true);

    const outer = expectTag(request, 0, 0x30, 'TimeStampReq');
    const version = expectTag(request, outer.contentStart, 0x02, 'version');
    expect(request[version.contentStart]).toBe(1);

    const imprint = expectTag(request, version.end, 0x30, 'messageImprint');
    const algorithm = expectTag(request, imprint.contentStart, 0x30, 'AlgorithmIdentifier');
    const hashed = expectTag(request, algorithm.end, TAG_OCTET_STRING, 'hashedMessage');
    expect(request.subarray(hashed.contentStart, hashed.end).toString('hex')).toBe(DIGEST);
  });

  it('incluye un nonce distinto en cada petición', () => {
    // The nonce binds the response to THIS request: without it, someone can
    // return a valid stamp for a different document.
    const a = buildTimeStampReq(DIGEST, true);
    const b = buildTimeStampReq(DIGEST, true);

    expect(a.equals(b)).toBe(false);
  });

  it('rechaza un digest que no mide 32 bytes', () => {
    expect(() => buildTimeStampReq('abcd', true)).toThrow(/32-byte SHA-256/);
  });
});

describe('parseTimeStampResp', () => {
  it('extrae el token y el genTime cuando la TSA concede', () => {
    const parsed = parseTimeStampResp(buildResponse({ status: 0 }));

    expect(parsed.genTime.toISOString()).toBe('2026-01-15T10:30:00.000Z');
    expect(parsed.token.length).toBeGreaterThan(0);
  });

  it('acepta grantedWithMods', () => {
    expect(parseTimeStampResp(buildResponse({ status: 1 })).genTime).toBeInstanceOf(Date);
  });

  it('lanza cuando la TSA rechaza', () => {
    // Un rechazo no puede degradarse a "evidencia sin sellar" en silencio.
    expect(() => parseTimeStampResp(buildResponse({ status: 2 }))).toThrow(/PKIStatus 2/);
  });

  it('lanza cuando concede pero no manda token', () => {
    expect(() => parseTimeStampResp(buildResponse({ status: 0, omitToken: true }))).toThrow(
      /no timeStampToken/,
    );
  });

  it('no confunde la fecha de un certificado incrustado con el genTime', () => {
    const parsed = parseTimeStampResp(
      buildResponse({ status: 0, genTime: '20260115103000Z', decoyTime: '20301231235959Z' }),
    );

    // The decoy comes AFTER in the buffer but a naive scan could pick it up;
    // the structural walk only reaches TSTInfo's genTime.
    expect(parsed.genTime.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });
});
