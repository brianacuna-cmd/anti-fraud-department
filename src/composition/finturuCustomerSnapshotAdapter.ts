import type { CustomerSnapshotProvider } from '../modules/case-management/domain/ports/CustomerSnapshotProvider.js';
import type { FinturuDirectoryRepository } from '../modules/case-management/domain/ports/FinturuDirectoryRepository.js';
import type { CustomerDetailReader } from '../modules/case-management/domain/ports/CustomerDetailReader.js';

/**
 * Compone la foto del cliente al congelar un informe (puerto
 * `CustomerSnapshotProvider`), leyéndola del directorio en vivo.
 *
 * Vive en la composición y no dentro de `case-management` por la misma razón
 * que el resto de adaptadores de este directorio: el módulo de expedientes
 * define la forma que necesita y es el arranque quien decide que detrás hay
 * Finturu.
 *
 * Se apoya en el directorio en lugar de pedir cliente por cliente a Finturu, y
 * la diferencia no es de comodidad: la correlación de transferencias es la
 * parte cara de componer el padrón, y ya está hecha y cacheada para el listado.
 * Reaprovecharla significa que congelar un informe no añade ni una vuelta de
 * red contra Bridge —que es justo lo que este cambio busca evitar— y que la
 * foto del informe coincide con lo que el analista vio en pantalla.
 *
 * El precio es que la foto puede tener la antigüedad del TTL del directorio, un
 * minuto por defecto. Frente a lo que sustituye —una copia tomada el día que se
 * abrió el expediente, que podían ser meses— es una mejora de otro orden.
 */
export function createFinturuCustomerSnapshotAdapter(
  directory: FinturuDirectoryRepository,
  customerDetail?: CustomerDetailReader,
): CustomerSnapshotProvider {
  return {
    async snapshotFor(customer): Promise<Record<string, unknown> | null> {
      const [entry, detail] = await Promise.all([
        directory.findByCustomer({
          idUserBridge: customer.bridgeUserId,
          email: customer.email,
        }),
        customerDetail?.detailFor({ idUserBridge: customer.bridgeUserId }),
      ]);

      // El cliente ya no está en el padrón: dado de baja en origen. Es
      // información, no un fallo, y el informe la refleja como un hueco.
      if (entry === null) {
        return null;
      }

      /*
       * Igual que en la ficha: el detalle por cliente manda sobre el padrón,
       * porque el padrón compone billeteras y movimientos desde listados cuyos
       * campos de enlace llegan nulos. Un informe congelado con las dos listas
       * vacías documentaría una carencia del proveedor como si fuera un hecho
       * sobre el cliente — y eso es justo lo que un informe no puede hacer.
       */
      const wallets = detail && detail.wallets.length > 0 ? detail.wallets : entry.wallets;
      const transfers = detail && detail.transfers.length > 0 ? detail.transfers : entry.transfers;

      return {
        idUser: entry.idUser,
        idUserBridge: entry.idUserBridge,
        name: entry.name,
        lastname: entry.lastname,
        email: entry.email,
        phone: entry.phone,
        status: entry.status,
        address: entry.address,
        idCustomer: entry.idCustomer,
        wallets,
        transfers,
        // Se congela el aviso, no solo los datos: quien lea el informe dentro
        // de dos años tiene que poder distinguir «sin saldo» de «el proveedor
        // no lo dijo».
        walletsIncomplete: detail?.walletsIncomplete ?? false,
        stripe: entry.stripe,
        riskScore: entry.riskScore,
        // Deja constancia dentro de la propia foto de cuándo se tomó: quien lea
        // el informe dentro de dos años no tiene por qué deducirlo de la fecha
        // del documento.
        capturedAt: new Date().toISOString(),
      };
    },
  };
}
