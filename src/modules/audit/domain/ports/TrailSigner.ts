/**
 * Firma del volcado de auditoría (AUD-003).
 *
 * La firma existe para que un auditor de SOC 2 o ISO 27001 pueda comprobar,
 * SIN confiar en este sistema, que el fichero que tiene en la mano es el que
 * se emitió. Eso descarta un HMAC: verificarlo exigiría el mismo secreto con
 * el que se firmó, así que solo podría comprobarlo quien también podría haber
 * fabricado el fichero. Una firma que solo valida el firmante no prueba nada.
 *
 * De ahí Ed25519 y la clave pública viajando en el manifiesto: el auditor
 * verifica por su cuenta, con herramientas suyas.
 */
export interface TrailSignature {
  readonly algorithm: 'Ed25519';
  /** Firma sobre los bytes EXACTOS del fichero, en base64. */
  readonly signature: string;
  /** Clave pública en formato SPKI/PEM, para que un tercero pueda verificar. */
  readonly publicKeyPem: string;
}

export interface TrailSigner {
  /**
   * `null` cuando no hay clave configurada.
   *
   * Devolver `null` y no lanzar aquí es deliberado: es el caso de uso quien
   * decide qué hacer con un export que no se puede firmar, y hoy decide
   * RECHAZARLO. Un fichero de auditoría sin firma entregado como firmado es
   * peor que no tener export.
   */
  sign(payload: Buffer): TrailSignature | null;
}
