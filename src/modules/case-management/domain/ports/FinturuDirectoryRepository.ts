/**
 * Directorio de clientes de Finturu: vista de LECTURA, nunca almacenada.
 *
 * No es un agregado de dominio y ya no es tampoco una copia local. Durante un
 * tiempo se materializó en Mongo porque componer el padrón recorriendo Bridge
 * costaba unos tres minutos, y eso hacía inviable hacerlo en cada petición.
 * Finturu pasó a servirlo desde su propia base de datos —la composición entera
 * ronda el segundo y medio—, así que la copia dejó de comprar tiempo y solo
 * dejaba una segunda residencia de datos personales que custodiar. El único
 * implementador es `FinturuLiveDirectory`, que compone al vuelo y cachea en
 * memoria.
 *
 * **No está particionado por organización.** Detrás hay una única cuenta de
 * Bridge, así que el padrón es el mismo se mire desde donde se mire. Lo que sí
 * es por organización es el cruce con los expedientes, y eso vive en `Cases`.
 *
 * Deliberadamente separado de `Cases`: un cliente monitoreado no es un
 * expediente de fraude. Mezclarlos convertiría a los 1600+ clientes del padrón
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
  /**
   * Antigüedad de lo que se está viendo: cuándo se compuso el padrón que sirve
   * esta página. Antes era «cuándo se sincronizó»; con la lectura en vivo el
   * nombre se queda por compatibilidad con la pantalla, pero el significado
   * para quien lo lee es el mismo — de cuándo son estos datos.
   */
  readonly syncedAt: string | null;
}

/** Claves por las que un expediente puede reclamar a su cliente. */
export interface FinturuCustomerKeys {
  readonly idUser?: string | null;
  readonly idUserBridge?: string | null;
  readonly email?: string | null;
}

export interface FinturuDirectoryRepository {
  page(query: FinturuDirectoryQuery): Promise<FinturuDirectoryPage>;

  /**
   * Un cliente del padrón, ya correlacionado con sus billeteras, movimientos y
   * Stripe.
   *
   * Sale de la MISMA composición que sirve el listado, no de una tanda de
   * llamadas por cliente: la correlación de transferencias es justo la parte
   * cara, y repetirla por expediente abierto multiplicaría el tráfico contra
   * Finturu que este cambio pretende reducir.
   *
   * `null` cuando el cliente ya no está en el padrón —dado de baja en origen—,
   * que es información y no un error.
   */
  findByCustomer(keys: FinturuCustomerKeys): Promise<FinturuDirectoryEntry | null>;

  lastSyncedAt(): Promise<string | null>;
}
