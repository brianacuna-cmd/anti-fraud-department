import { FinturuLiveDirectory } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuLiveDirectory.js';
import type { FinturuApiClient } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

/**
 * El directorio servido en vivo: caché con caducidad, vuelo único, y la
 * búsqueda y la paginación que Finturu no hace.
 *
 * Lo que se prueba aquí no es la correlación —eso es
 * `composeFinturuDirectory`— sino las tres promesas que sustituyen a la copia
 * local: que N lecturas no son N vueltas a Finturu, que la búsqueda cubre todo
 * el padrón y no la página, y que una caída del proveedor no vacía la pantalla
 * si ya había algo que enseñar.
 */

const NOW = fromDate(new Date('2026-08-25T10:00:00.000Z'));

interface StubCounts {
  customers: number;
}

/** Cliente de Finturu falso que cuenta cuántas veces se le pide el padrón. */
function stubClient(overrides: { customers?: unknown[]; failAfter?: number } = {}) {
  const counts: StubCounts = { customers: 0 };
  const customers = overrides.customers ?? [
    { idUser: '1', idUserBridge: 'b-1', name: 'Valentina', lastname: 'Jaramillo', email: 'v@example.com' },
    { idUser: '2', idUserBridge: 'b-2', name: 'Diego', lastname: 'Felipe', email: 'ddiego@example.com' },
    { idUser: '3', idUserBridge: 'b-3', name: 'Ana', lastname: 'Ruiz', email: 'ana@example.com' },
  ];

  const client = {
    async getCustomers() {
      counts.customers += 1;
      if (overrides.failAfter !== undefined && counts.customers > overrides.failAfter) {
        throw new Error('Finturu no responde');
      }
      return customers;
    },
    async getWallets() {
      return [];
    },
    async getTransfers() {
      return [];
    },
    async getStripeCustomers() {
      return [];
    },
  } as unknown as FinturuApiClient;

  return { client, counts };
}

const directory = (client: FinturuApiClient, ttlMs = 60_000) =>
  new FinturuLiveDirectory({ client, clock: new FixedClock(NOW), ttlMs });

describe('FinturuLiveDirectory: caché', () => {
  it('reutiliza la composición dentro del TTL en lugar de volver a Finturu', async () => {
    const { client, counts } = stubClient();
    const dir = directory(client);

    await dir.page({ limit: 10, offset: 0 });
    await dir.page({ limit: 10, offset: 0 });
    await dir.page({ limit: 10, offset: 0, search: 'ana' });

    expect(counts.customers).toBe(1);
  });

  it('vuelve a componer cuando el TTL ha vencido', async () => {
    const { client, counts } = stubClient();
    const dir = directory(client, 0);

    await dir.page({ limit: 10, offset: 0 });
    await dir.page({ limit: 10, offset: 0 });

    expect(counts.customers).toBe(2);
  });

  it('de un solo vuelo: peticiones simultáneas comparten una sola composición', async () => {
    /*
     * Es la promesa que de verdad protege a Finturu. La pantalla del directorio
     * dispara una petición por tecla, así que sin esto la primera carga tras
     * caducar el TTL lanzaría tantas composiciones como teclas —cada una
     * arrastrando los 5 MB de transferencias.
     */
    const { client, counts } = stubClient();
    const dir = directory(client);

    await Promise.all([
      dir.page({ limit: 10, offset: 0 }),
      dir.page({ limit: 10, offset: 0 }),
      dir.page({ limit: 10, offset: 0 }),
    ]);

    expect(counts.customers).toBe(1);
  });

  it('sirve la composición anterior cuando Finturu se cae', async () => {
    // Un padrón de hace un minuto es infinitamente más útil que un error: el
    // directorio es una vista de consulta, no un acto que dependa de estar al día.
    const { client } = stubClient({ failAfter: 1 });
    const dir = directory(client, 0);

    const first = await dir.page({ limit: 10, offset: 0 });
    const afterFailure = await dir.page({ limit: 10, offset: 0 });

    expect(first.total).toBe(3);
    expect(afterFailure.total).toBe(3);
  });

  it('propaga el fallo cuando no hay nada anterior que servir', async () => {
    const { client } = stubClient({ failAfter: 0 });
    const dir = directory(client);

    await expect(dir.page({ limit: 10, offset: 0 })).rejects.toThrow('Finturu no responde');
  });
});

describe('FinturuLiveDirectory: búsqueda y paginación', () => {
  it('cuenta el total sobre TODO el padrón, no sobre la página', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    const page = await dir.page({ limit: 1, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it('desplaza por offset', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    const page = await dir.page({ limit: 1, offset: 2 });

    expect(page.items[0]?.idUser).toBe('3');
  });

  it('busca por nombre, correo e identificadores sin distinguir caja', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    await expect(dir.page({ limit: 10, offset: 0, search: 'VALENTINA' })).resolves.toMatchObject({ total: 1 });
    await expect(dir.page({ limit: 10, offset: 0, search: 'ddiego@' })).resolves.toMatchObject({ total: 1 });
    await expect(dir.page({ limit: 10, offset: 0, search: 'b-3' })).resolves.toMatchObject({ total: 1 });
  });

  it('la búsqueda cubre el padrón entero, no solo la primera página', async () => {
    // Con la copia local esto lo hacía Mongo. Al pasar a memoria hay que
    // comprobar que se filtra ANTES de cortar, no después.
    const { client } = stubClient();
    const dir = directory(client);

    const page = await dir.page({ limit: 1, offset: 0, search: 'ana' });

    expect(page.total).toBe(1);
    expect(page.items[0]?.idUser).toBe('3');
  });

  it('devuelve página vacía y total cero cuando no hay coincidencias', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    const page = await dir.page({ limit: 10, offset: 0, search: 'nadie-asi' });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('informa de cuándo se compuso lo que sirve', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    const page = await dir.page({ limit: 10, offset: 0 });

    expect(page.syncedAt).toBe(NOW);
  });
});

describe('FinturuLiveDirectory: búsqueda exacta para la ficha', () => {
  it('encuentra al cliente por idUser, por idUserBridge y por correo', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    await expect(dir.findByCustomer({ idUser: '2' })).resolves.toMatchObject({ idUser: '2' });
    await expect(dir.findByCustomer({ idUserBridge: 'b-2' })).resolves.toMatchObject({ idUser: '2' });
    await expect(dir.findByCustomer({ email: 'DDIEGO@example.com' })).resolves.toMatchObject({ idUser: '2' });
  });

  it('devuelve null cuando el cliente ya no está en el padrón', async () => {
    // Dado de baja en origen. Es información —el informe la congela como un
    // hueco— y no un error.
    const { client } = stubClient();
    const dir = directory(client);

    await expect(dir.findByCustomer({ idUser: '999' })).resolves.toBeNull();
  });

  it('devuelve null cuando no se le da ninguna clave', async () => {
    const { client } = stubClient();
    const dir = directory(client);

    await expect(dir.findByCustomer({})).resolves.toBeNull();
  });

  it('comparte la caché con el listado: no compone una segunda vez', async () => {
    const { client, counts } = stubClient();
    const dir = directory(client);

    await dir.page({ limit: 10, offset: 0 });
    await dir.findByCustomer({ idUser: '1' });

    expect(counts.customers).toBe(1);
  });
});
