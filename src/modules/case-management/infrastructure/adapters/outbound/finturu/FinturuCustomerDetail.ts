import type {
  CustomerDetailReader,
  CustomerDetailSnapshot,
} from '../../../../domain/ports/CustomerDetailReader.js';
import type { FinturuApiClient } from './FinturuApiClient.js';

const EMPTY: CustomerDetailSnapshot = { wallets: [], transfers: [], walletsIncomplete: false };

/**
 * Una billetera que llega sin dirección Y sin red no es una billetera sin
 * datos: es un registro que el proveedor devolvió a medias. Hoy es el caso
 * normal —su mapper emite ambos campos como literales— y el día que deje de
 * serlo, esta comprobación se apaga sola.
 */
function isIncomplete(wallet: Record<string, unknown>): boolean {
  const address = wallet.address;
  const chain = wallet.chain;
  const vacio = (v: unknown) => v === null || v === undefined || v === '';
  return vacio(address) && vacio(chain);
}

/**
 * Lee el detalle de un cliente por sus rutas propias.
 *
 * `getUserWallets` y `getCustomerFinturuTransfers` son las dos que resuelven
 * el dueño por su cuenta en lugar de fiarse de los campos de enlace que el
 * proveedor deja en `null`. Van en paralelo y cada una degrada por separado:
 * `FinturuApiClient` ya convierte cualquier fallo en lista vacía, así que un
 * proveedor caído produce una ficha incompleta en lugar de una ficha rota.
 */
export function createFinturuCustomerDetail(client: FinturuApiClient): CustomerDetailReader {
  return {
    async detailFor(keys): Promise<CustomerDetailSnapshot> {
      const { idUserBridge } = keys;

      // Ambas rutas se direccionan por el id de Bridge; sin él no hay a quién
      // preguntar, y devolver listas vacías sería indistinguible de un cliente
      // sin actividad.
      if (!idUserBridge) {
        return EMPTY;
      }

      const [wallets, transfers] = await Promise.all([
        client.getUserWallets(idUserBridge),
        client.getCustomerFinturuTransfers(idUserBridge),
      ]);

      const walletRows = wallets as readonly Record<string, unknown>[];

      return {
        wallets: walletRows,
        transfers: transfers as readonly Record<string, unknown>[],
        // Solo cuenta como incompleto si hay billeteras Y todas vienen a
        // medias. Cero billeteras es un dato legítimo, no una carencia.
        walletsIncomplete: walletRows.length > 0 && walletRows.every(isIncomplete),
      };
    },
  };
}
