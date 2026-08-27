import { createSyncFinturuDirectoryUseCase } from '../../../../src/modules/case-management/application/SyncFinturuDirectory.js';
import type { FinturuApiClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type {
  FinturuDirectoryEntry,
  FinturuDirectoryRepository,
} from '../../../../src/modules/case-management/domain/ports/FinturuDirectoryRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-25T10:00:00.000Z'));
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

class CapturingDirectory implements FinturuDirectoryRepository {
  entries: readonly FinturuDirectoryEntry[] = [];

  async replaceAll(entries: readonly FinturuDirectoryEntry[]): Promise<void> {
    this.entries = entries;
  }

  async page(): Promise<never> {
    throw new Error('no usado');
  }

  async lastSyncedAt(): Promise<string | null> {
    return null;
  }
}

function build(transfers: readonly unknown[]) {
  const directory = new CapturingDirectory();
  const finturuClient = {
    getCustomers: async () => [{ idUser: 'u-1', idUserBridge: BRIDGE_USER, email: 'santiago@finturu.com' }],
    getWallets: async () => [{ idWallet: WALLET_ID, customerId: BRIDGE_USER, chain: 'solana', address: ADDRESS }],
    getTransfers: async () => transfers,
    getStripeCustomers: async () => [],
    getStripeTransfers: async () => [],
  } as unknown as FinturuApiClient;

  return {
    directory,
    syncDirectory: createSyncFinturuDirectoryUseCase({
      finturuClient,
      directory,
      clock: new FixedClock(NOW),
    }),
  };
}

describe('SyncFinturuDirectory — correlación de transferencias', () => {
  it('reconoce las claves snake_case de Bridge en source y destination', async () => {
    const { directory, syncDirectory } = build([
      TRANSFER_BY_WALLET_ID,
      TRANSFER_BY_ADDRESS,
      TRANSFER_OF_SOMEONE_ELSE,
    ]);

    await syncDirectory();

    const [entry] = directory.entries;
    expect(entry!.transfers.map((t) => (t as { idTransfer: string }).idTransfer)).toEqual([
      'por-id-de-billetera',
      'por-direccion',
    ]);
  });

  it('sigue reconociendo la variante camelCase', async () => {
    const { directory, syncDirectory } = build([
      {
        idTransfer: 'camel',
        source: { bridgeWalletId: WALLET_ID },
        destination: { toAddress: 'otra' },
      },
    ]);

    await syncDirectory();

    expect(directory.entries[0]!.transfers).toHaveLength(1);
  });

  it('correlaciona por on_behalf_of aunque no haya billetera reconocida', async () => {
    const { directory, syncDirectory } = build([
      { idTransfer: 'a-nombre-de', on_behalf_of: BRIDGE_USER, source: {}, destination: {} },
    ]);

    await syncDirectory();

    expect(directory.entries[0]!.transfers).toHaveLength(1);
  });

  it('no atribuye al cliente las transferencias de otros', async () => {
    const { directory, syncDirectory } = build([TRANSFER_OF_SOMEONE_ELSE]);

    await syncDirectory();

    expect(directory.entries[0]!.transfers).toHaveLength(0);
  });
});
