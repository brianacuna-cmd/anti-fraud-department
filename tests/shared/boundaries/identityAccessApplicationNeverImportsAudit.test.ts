import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APPLICATION_ROOT = join(__dirname, '../../../src/modules/identity-access/application');
const AUDIT_IMPORT_PATTERN = /from\s+['"][^'"]*\/modules\/audit\//;

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(fullPath);
    }
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

/**
 * Static guard for design D-A2's boundaries constraint: identity-access's
 * `application` layer depends only on its own module's `domain` (here, the
 * `AuditRecorder` port) — it must NEVER import the `audit` module directly.
 * `eslint-plugin-boundaries` already enforces this at the layer-type level
 * (`application` disallow rule), but that rule is generic across all
 * modules; this test locks in the specific audit-module invariant this
 * change introduces, matching spec "Atomic Emission" and design §2.
 */
describe('identity-access/application boundaries', () => {
  it('never imports the audit module directly', () => {
    const files = collectTsFiles(APPLICATION_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => AUDIT_IMPORT_PATTERN.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
