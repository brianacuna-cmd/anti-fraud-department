/**
 * Directorio de clientes de Finturu materializado en local.
 *
 * No es un agregado de dominio: es una copia de lectura de datos que viven en
 * Bridge/Stripe. Existe porque recorrer esas APIs en vivo cuesta minutos
 * (medido: ~3 min el padrón completo), lo que hace inviable componer el
 * directorio en cada petición. El sync lo refresca por lotes; las pantallas
 * leen de aquí.
 *
 * **No está particionado por organización.** Detrás hay una única cuenta de
 * Bridge, así que el padrón es el mismo se mire desde donde se mire; darle un
 * `OrganizationId` solo duplicaba filas y abría la puerta a que el sync
 * escribiera bajo una organización y la pantalla leyera bajo otra. Lo que sí
 * es por organización es el cruce con los expedientes, y eso vive en `Cases`.
 *
 * Deliberadamente separado de `Cases`: un cliente monitoreado no es un
 * expediente de fraude. Mezclarlos convertiría a los 1400+ clientes del padrón
 * en casos abiertos.
 */

export interface FinturuDirectoryEntry {
  readonly idUser: string;
  readonly idUserBridge: string | null;
  readonly name: string | null;
  readonly lastname: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string | null;
  readonly address: string | null;
  readonly idCustomer: string | null;
  readonly wallets: readonly unknown[];
  readonly transfers: readonly unknown[];
  readonly stripe: Record<string, unknown> | null;
  readonly riskScore: number;
}

export interface FinturuDirectoryQuery {
  readonly limit: number;
  readonly offset: number;
  /** Búsqueda por nombre, email, teléfono, identificadores o dirección de wallet. */
  readonly search?: string;
}

export interface FinturuDirectoryPage {
  readonly items: readonly FinturuDirectoryEntry[];
  /** Total de clientes que cumplen el filtro, para paginar de verdad. */
  readonly total: number;
  /** Cuándo se refrescó el directorio por última vez; `null` si nunca. */
  readonly syncedAt: string | null;
}

export interface FinturuDirectoryRepository {
  /**
   * Reemplaza el directorio. Los clientes que ya no vengan en el lote se
   * eliminan, de modo que una baja en origen desaparece de aquí.
   */
  replaceAll(entries: readonly FinturuDirectoryEntry[], syncedAt: string): Promise<void>;

  page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage>;

  lastSyncedAt(): Promise<string | null>;
}
