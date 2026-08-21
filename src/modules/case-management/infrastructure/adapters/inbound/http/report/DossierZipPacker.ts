import JSZip from 'jszip';
import type { CaseAuditDossier } from '../../../../../application/GenerateCaseAuditDossier.js';

/**
 * Empaqueta un `CaseAuditDossier` en un ZIP.
 *
 * Vive en infraestructura y no en el caso de uso a propósito: el caso de uso
 * decide QUÉ ficheros lleva el dossier y por qué, que es una decisión de
 * negocio auditable; el contenedor con que se entrega es un detalle de
 * transporte. Cambiar mañana a tar.gz no debería tocar nada de lo anterior.
 */
export class DossierZipPacker {
  readonly contentType = 'application/zip';

  async pack(dossier: CaseAuditDossier): Promise<Buffer> {
    const zip = new JSZip();
    const date = new Date(0);

    for (const entry of dossier.entries) {
      // Fecha fija en todas las entradas: sin esto JSZip sella cada fichero con
      // la hora de generacion y dos paquetes del MISMO expediente congelado
      // salen con bytes distintos. Un dossier legal tiene que poder
      // reproducirse: si su hash cambia cada vez que se pide, no se puede
      // referenciar por hash en un escrito.
      zip.file(entry.path, entry.bytes, { date, binary: true });
    }

    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  /** Nombre del adjunto. Lleva el expediente y el informe: identifica el paquete fuera del sistema. */
  filenameFor(dossier: CaseAuditDossier): string {
    return `dossier-${dossier.caseId}-${dossier.reportId}.zip`;
  }
}
