/**
 * Destino inmutable del archivado en frío (AUD-004).
 *
 * "Inmutable" no lo garantiza este código: lo garantiza el bucket, con S3
 * Object Lock en modo COMPLIANCE. Ese detalle importa, porque es lo que hace
 * que el archivo valga ante un auditor: ni un administrador de la cuenta AWS
 * puede borrar un objeto bloqueado antes de que venza su retención. Si el
 * bucket no tiene Object Lock activo, este puerto sigue funcionando y la
 * garantía desaparece sin que nada falle — por eso el adaptador lo comprueba
 * al arrancar en vez de confiar.
 */
export interface ArchivedObject {
  readonly key: string;
  readonly bytes: number;
  /** SHA-256 del objeto subido, para poder comprobar la copia más adelante. */
  readonly sha256: string;
  /** Hasta cuándo queda bloqueado, tal como lo confirmó el destino. */
  readonly retainUntil: string | null;
}

export interface ColdStorage {
  /** Sube el objeto y devuelve lo necesario para probar que se subió. */
  put(key: string, body: Buffer, contentType: string): Promise<ArchivedObject>;
}
