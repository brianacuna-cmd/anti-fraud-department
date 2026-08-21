/**
 * Object-store seam for evidence blobs (outside Mongo). The composition root
 * wires a concrete adapter (filesystem for dev; S3 in despliegue) selected by
 * env. `put` is idempotent by `storageKey`; `get` returns null when absent.
 */
export interface EvidenceStore {
  put(storageKey: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
  /**
   * URL prefirmada de descarga directa (INV-004), o `undefined` si el
   * adaptador no sabe emitirlas.
   *
   * Es OPCIONAL a propósito. Firmar una URL es una capacidad del almacén de
   * objetos, no del puerto: el adaptador de filesystem no puede emitir nada
   * que el navegador alcance sin pasar por la API. Declararlo obligatorio
   * obligaria a ese adaptador a devolver una URL falsa o a lanzar, y las dos
   * cosas mueven el problema a tiempo de ejecución. Asi, quien lo necesita
   * pregunta si existe y decide.
   */
  presignDownload?(storageKey: string, expiresInSeconds: number): Promise<string>;
}
