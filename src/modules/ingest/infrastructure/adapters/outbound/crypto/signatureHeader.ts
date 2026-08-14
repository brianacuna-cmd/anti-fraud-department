import { timingSafeEqual } from 'node:crypto';

export function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

export function parseTaggedSignature(
  header: string,
  scheme: string,
): { timestamp: number; signatures: string[] } | null {
  let timestamp = -1;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      timestamp = parsed;
    }
    if (key === scheme && value.length > 0) {
      signatures.push(value);
    }
  }

  if (timestamp < 0 || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
