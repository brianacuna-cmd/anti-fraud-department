/**
 * Detalle de UN cliente traído de sus endpoints propios, no del padrón.
 *
 * Existe por una asimetría del proveedor que no podemos arreglar desde aquí:
 * los listados globales de billeteras y transferencias llegan con los campos
 * de enlace en `null` —`wallets[].customerId`, `transfers[].onBehalfOf`— así
 * que el padrón no puede atribuirle ni una billetera ni un movimiento a nadie
 * y los compone siempre vacíos. Las rutas POR CLIENTE, en cambio, resuelven el
 * dueño por su cuenta y sí devuelven las filas correctas.
 *
 * De ahí la regla: para una lista, el padrón; para una ficha o un informe,
 * esto. Una ficha son dos peticiones más y la diferencia entre enseñar los
 * movimientos de alguien o enseñar un hueco.
 *
 * Cuando el proveedor complete sus mappers, esta vía seguirá siendo la buena
 * para el detalle —es más fresca y más precisa— y el padrón dejará de venir
 * vacío por su lado. Ninguna de las dos cosas obliga a tocar esto.
 */
export interface CustomerDetailSnapshot {
  readonly wallets: readonly Record<string, unknown>[];
  readonly transfers: readonly Record<string, unknown>[];
  /**
   * El proveedor devolvió billeteras sin dirección ni red: registros
   * incompletos, no billeteras sin datos.
   *
   * Se propaga en lugar de silenciarse porque quien lee una ficha necesita
   * distinguir «este cliente no tiene saldo» de «no sabemos su saldo». En un
   * expediente de fraude, afirmar lo primero cuando es lo segundo es inventar
   * prueba.
   */
  readonly walletsIncomplete: boolean;
}

export interface CustomerDetailReader {
  detailFor(keys: {
    readonly idUserBridge: string | null;
  }): Promise<CustomerDetailSnapshot>;
}
