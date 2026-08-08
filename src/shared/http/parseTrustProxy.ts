/**
 * Parses `process.env.TRUST_PROXY` into the shape `createApp`'s `trustProxy`
 * option expects (design D-A7/§4a). `undefined`/empty => `false`
 * (fail-safe default — a production deployment behind a real proxy MUST set
 * this explicitly). `'true'`/`'false'` => boolean. A pure integer string =>
 * the hop count Express expects for `X-Forwarded-For` chains. Anything else
 * (e.g. `'loopback'`, a CIDR, a comma-separated list) passes through
 * verbatim — Express's `trust proxy` setting accepts all of these natively.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}
