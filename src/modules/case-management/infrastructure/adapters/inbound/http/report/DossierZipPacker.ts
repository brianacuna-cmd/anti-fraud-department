import JSZip from 'jszip';
import type { CaseAuditDossier } from '../../../../../application/GenerateCaseAuditDossier.js';

/**
 * Packs a `CaseAuditDossier` into a ZIP.
 *
 * Lives in infrastructure and not in the use case on purpose: the use case
 * decides WHICH files the dossier carries and why, which is an auditable
 * business decision; the container it is delivered in is a transport
 * detail. Switching to tar.gz tomorrow should not touch any of the above.
 */
export class DossierZipPacker {
  readonly contentType = 'application/zip';

  async pack(dossier: CaseAuditDossier): Promise<Buffer> {
    const zip = new JSZip();
    const date = new Date(0);

    for (const entry of dossier.entries) {
      // Fixed date on every entry: without this JSZip stamps each file with
      // generation time and two packages of the SAME frozen case come out
      // with different bytes. A legal dossier has to be reproducible: if its
      // hash changes every time it is requested, it cannot be referenced by
      // hash in a filing.
      zip.file(entry.path, entry.bytes, { date, binary: true });
    }

    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  /** Attachment name. Carries the case and the report: identifies the package outside the system. */
  filenameFor(dossier: CaseAuditDossier): string {
    return `dossier-${dossier.caseId}-${dossier.reportId}.zip`;
  }
}
