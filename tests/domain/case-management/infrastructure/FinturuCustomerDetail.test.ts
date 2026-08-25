import { createFinturuCustomerDetail } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuCustomerDetail.js';
import type { FinturuApiClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

/**
 * El detalle por cliente: la vía que SÍ devuelve billeteras y movimientos.
 *
 * Los listados globales del proveedor llegan con los campos de enlace en
 * `null`, así que el padrón compone las dos listas vacías para todo el mundo.
 * Estas pruebas fijan las dos cosas que esta capa tiene que garantizar: que
 * pregunta por la ruta correcta, y que no confunde «el proveedor no lo dijo»
 * con «el cliente no tiene».
 */

function stub(over: { wallets?: unknown[]; transfers?: unknown[] } = {}) {
  const calls: string[] = [];
  const client = {
    async getUserWallets(id: string) {
      calls.push(`wallets:${id}`);
      return over.wallets ?? [];
    },
    async getCustomerFinturuTransfers(id: string) {
      calls.push(`transfers:${id}`);
      return over.transfers ?? [];
    },
  } as unknown as FinturuApiClient;
  return { client, calls };
}

const completa = { idWallet: 'w-1', address: '0xABC', chain: 'polygon' };
const aMedias = { idWallet: 'w-2', address: null, chain: null };

describe('createFinturuCustomerDetail', () => {
  it('pide billeteras y movimientos por el id de Bridge', async () => {
    const { client, calls } = stub({ wallets: [completa], transfers: [{ id: 1 }] });

    const detail = await createFinturuCustomerDetail(client).detailFor({ idUserBridge: 'b-9' });

    expect(calls).toEqual(['wallets:b-9', 'transfers:b-9']);
    expect(detail.wallets).toHaveLength(1);
    expect(detail.transfers).toHaveLength(1);
  });

  it('no pregunta nada sin id de Bridge', async () => {
    // Las dos rutas se direccionan por ese id; sin él no hay a quién preguntar
    // y una respuesta vacía sería indistinguible de un cliente sin actividad.
    const { client, calls } = stub({ wallets: [completa] });

    const detail = await createFinturuCustomerDetail(client).detailFor({ idUserBridge: null });

    expect(calls).toEqual([]);
    expect(detail.wallets).toEqual([]);
    expect(detail.walletsIncomplete).toBe(false);
  });

  it('marca incompleto cuando TODAS las billeteras vienen sin dirección ni red', async () => {
    const { client } = stub({ wallets: [aMedias, { idWallet: 'w-3', address: '', chain: '' }] });

    const detail = await createFinturuCustomerDetail(client).detailFor({ idUserBridge: 'b-9' });

    expect(detail.walletsIncomplete).toBe(true);
    // Se conservan igualmente: el identificador es real y es con lo que se
    // pide el historial.
    expect(detail.wallets).toHaveLength(2);
  });

  it('no marca incompleto si al menos una billetera trae datos', async () => {
    const { client } = stub({ wallets: [aMedias, completa] });

    const detail = await createFinturuCustomerDetail(client).detailFor({ idUserBridge: 'b-9' });

    expect(detail.walletsIncomplete).toBe(false);
  });

  it('cero billeteras NO es incompleto', async () => {
    // Un cliente sin billeteras es un dato legítimo. Marcarlo como carencia
    // del proveedor sería inventar una duda que no existe.
    const { client } = stub({ wallets: [] });

    const detail = await createFinturuCustomerDetail(client).detailFor({ idUserBridge: 'b-9' });

    expect(detail.walletsIncomplete).toBe(false);
  });
});
