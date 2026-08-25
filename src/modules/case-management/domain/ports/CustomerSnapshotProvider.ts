/**
 * Foto del cliente en el proveedor, tomada EN EL MOMENTO de congelar el
 * informe.
 *
 * Sustituye a `Case.finturuCacheSnapshot`, que era una copia guardada en el
 * expediente desde su apertura y que el informe se limitaba a copiar. Guardarla
 * tenía dos problemas y solo uno era de privacidad: el otro es que un
 * expediente abierto hace seis meses congelaba en su informe la foto de hace
 * seis meses, no la del día del informe, y nadie que lo leyera podía saberlo.
 *
 * Sigue siendo un puerto y no una llamada directa porque el módulo de
 * expedientes no conoce a Finturu: el adaptador se inyecta en la composición.
 *
 * **Devuelve `null` en lugar de fallar.** El informe es el acto que cierra el
 * expediente; perderlo entero porque un proveedor externo no contesta sería
 * peor que congelarlo sin la foto del cliente. Los identificadores —correo,
 * wallet, usuario de Bridge, cliente de Stripe— sí viven en el expediente y se
 * congelan siempre, así que el sujeto queda identificado pase lo que pase.
 */
export interface CustomerSnapshotProvider {
  snapshotFor(customer: {
    readonly bridgeUserId: string | null;
    readonly stripeCustomerId: string | null;
    readonly email: string | null;
  }): Promise<Record<string, unknown> | null>;
}
