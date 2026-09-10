import { LiveFinturuDirectoryRepository } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/LiveFinturuDirectoryRepository.js';
import type { FinturuApiClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

const BRIDGE_USER = '73f18ee7-49d5-406f-b009-ed552a41a75a';
const WALLET_ID = '3bc450a3-305e-43a6-bd46-a06c4b824c1a';
const ADDRESS = 'Hjg6Y7nNLMBXTYgJsdc6s8i63Lyx4DNe66ZuJhAYvugP';

/**
 * Bridge devuelve `source`/`destination` en snake_case y Finturu los reenvía
 * sin normalizar, a diferencia de la capa exterior del transfer. Estos payloads
 * están copiados de una respuesta real de `/transfers`.
 */
const TRANSFER_BY_WALLET_ID = {
  idTransfer: 'por-id-de-billetera',
  amount: '42.23',
  currency: 'usd',
  state: 'payment_processed',
  source: { payment_rail: 'bridge_wallet', bridge_wallet_id: WALLET_ID },
  destination: { payment_rail: 'solana', to_address: 'otra-direccion-cualquiera' },
};

const TRANSFER_BY_ADDRESS = {
  idTransfer: 'por-direccion',
  amount: '10.0',
  currency: 'usd',
  state: 'payment_processed',
  source: { payment_rail: 'solana', from_address: 'una-direccion-ajena' },
  destination: { payment_rail: 'solana', to_address: ADDRESS },
};

const TRANSFER_OF_SOMEONE_ELSE = {
  idTransfer: 'de-otro-cliente',
  amount: '2.0',
  currency: 'usd',
  state: 'payment_processed',
  source: { payment_rail: 'bridge_wallet', bridge_wallet_id: 'billetera-ajena' },
  destination: { payment_rail: 'solana', to_address: 'direccion-ajena' },
};

function build(transfers: readonly unknown[]) {
  const finturuClient = {
    getCustomers: async () => [{ idUser: 'u-1', idUserBridge: BRIDGE_USER, email: 'santiago@finturu.com' }],
    getWallets: async () => [{ idWallet: WALLET_ID, customerId: BRIDGE_USER, chain: 'solana', address: ADDRESS }],
    getTransfers: async () => transfers,
    getStripeCustomers: async () => [],
    getStripeTransfers: async () => [],
  } as unknown as FinturuApiClient;

  return new LiveFinturuDirectoryRepository(finturuClient);
}

describe('LiveFinturuDirectoryRepository — correlación de transferencias', () => {
  it('reconoce las claves snake_case de Bridge en source y destination', async () => {
    const directory = build([TRANSFER_BY_WALLET_ID, TRANSFER_BY_ADDRESS, TRANSFER_OF_SOMEONE_ELSE]);

    const page = await directory.page({ limit: 10, offset: 0 });

    const [entry] = page.items;
    expect(entry!.transfers.map((t) => (t as { idTransfer: string }).idTransfer)).toEqual([
      'por-id-de-billetera',
      'por-direccion',
    ]);
  });

  it('sigue reconociendo la variante camelCase', async () => {
    const directory = build([
      {
        idTransfer: 'camel',
        source: { bridgeWalletId: WALLET_ID },
        destination: { toAddress: 'otra' },
      },
    ]);

    const page = await directory.page({ limit: 10, offset: 0 });

    expect(page.items[0]!.transfers).toHaveLength(1);
  });

  it('correlaciona por on_behalf_of aunque no haya billetera reconocida', async () => {
    const directory = build([
      { idTransfer: 'a-nombre-de', on_behalf_of: BRIDGE_USER, source: {}, destination: {} },
    ]);

    const page = await directory.page({ limit: 10, offset: 0 });

    expect(page.items[0]!.transfers).toHaveLength(1);
  });

  it('no atribuye al cliente las transferencias de otros', async () => {
    const directory = build([TRANSFER_OF_SOMEONE_ELSE]);

    const page = await directory.page({ limit: 10, offset: 0 });

    expect(page.items[0]!.transfers).toHaveLength(0);
  });
});
