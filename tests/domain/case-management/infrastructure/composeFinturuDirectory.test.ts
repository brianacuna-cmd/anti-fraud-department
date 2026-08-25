import { composeFinturuDirectory } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/composeFinturuDirectory.js';
import type {
  FinturuCustomerDto,
  FinturuStripeCustomerDto,
  FinturuTransferDto,
  FinturuWalletDto,
} from '../../../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';

/**
 * La correlación del padrón: qué billeteras, movimientos y datos de Stripe le
 * tocan a cada cliente.
 *
 * Vivía sin una sola prueba dentro del sync por lotes. Cuando el padrón dejó
 * de guardarse, esta función pasó de ejecutarse cada seis horas en segundo
 * plano a servir CADA lectura del directorio, y de paso se cambió el filtro
 * anidado por índices en tabla hash. Un cambio de algoritmo sobre código sin
 * red es exactamente lo que estas pruebas cubren: que la nueva forma empareja
 * lo mismo que la vieja.
 */

const customer = (over: Partial<FinturuCustomerDto> = {}): FinturuCustomerDto => ({
  idUser: '100',
  idUserBridge: 'bridge-100',
  name: 'Valentina',
  lastname: 'Jaramillo',
  email: 'v@example.com',
  status: 'active',
  phone: '+57300',
  ...over,
});

const wallet = (over: Partial<FinturuWalletDto> = {}): FinturuWalletDto => ({
  idWallet: 'w-1',
  customerId: 'bridge-100',
  chain: 'solana',
  address: 'ADDR-1',
  ...over,
});

const transfer = (over: Partial<FinturuTransferDto> = {}): FinturuTransferDto => ({
  idTransfer: 't-1',
  amount: '10',
  currency: 'usd',
  state: 'payment_processed',
  ...over,
});

const compose = (over: Partial<Parameters<typeof composeFinturuDirectory>[0]> = {}) =>
  composeFinturuDirectory({
    customers: [customer()],
    wallets: [],
    transfers: [],
    stripeCustomers: [],
    ...over,
  });

describe('composeFinturuDirectory: identidad del cliente', () => {
  it('descarta al cliente sin identificador estable', () => {
    // Sin `idUser` ni `idUserBridge` no hay clave con la que referirse a él, y
    // colarlo dejaría una fila que ninguna pantalla puede abrir.
    const entries = compose({ customers: [customer({ idUser: undefined, idUserBridge: undefined })] });

    expect(entries).toEqual([]);
  });

  it('cae al idUserBridge cuando falta el idUser', () => {
    const entries = compose({ customers: [customer({ idUser: undefined })] });

    expect(entries[0]?.idUser).toBe('bridge-100');
  });

  it('toma la dirección de la primera billetera como dirección del cliente', () => {
    const entries = compose({ wallets: [wallet({ address: 'PRIMERA' }), wallet({ idWallet: 'w-2', address: 'SEGUNDA' })] });

    expect(entries[0]?.address).toBe('PRIMERA');
  });
});

describe('composeFinturuDirectory: billeteras', () => {
  it('asigna a cada cliente solo las billeteras de su idUserBridge', () => {
    const entries = compose({
      customers: [customer(), customer({ idUser: '200', idUserBridge: 'bridge-200', email: 'otro@example.com' })],
      wallets: [wallet(), wallet({ idWallet: 'w-9', customerId: 'bridge-200', address: 'ADDR-9' })],
    });

    expect(entries[0]?.wallets).toHaveLength(1);
    expect((entries[0]?.wallets[0] as FinturuWalletDto).idWallet).toBe('w-1');
    expect((entries[1]?.wallets[0] as FinturuWalletDto).idWallet).toBe('w-9');
  });

  it('deja sin billeteras al cliente que no tiene idUserBridge', () => {
    const entries = compose({ customers: [customer({ idUserBridge: undefined })], wallets: [wallet()] });

    expect(entries[0]?.wallets).toEqual([]);
  });
});

describe('composeFinturuDirectory: movimientos', () => {
  it('reclama la transferencia por onBehalfOf', () => {
    const entries = compose({ transfers: [transfer({ onBehalfOf: 'bridge-100' })] });

    expect(entries[0]?.transfers).toHaveLength(1);
  });

  it('reclama la transferencia por el id de billetera, sea origen o destino', () => {
    const entries = compose({
      wallets: [wallet()],
      transfers: [
        transfer({ idTransfer: 'origen', source: { bridgeWalletId: 'w-1' } }),
        transfer({ idTransfer: 'destino', destination: { bridgeWalletId: 'w-1' } }),
      ],
    });

    expect(entries[0]?.transfers).toHaveLength(2);
  });

  it('reclama la transferencia por dirección, comparando sin distinguir mayúsculas', () => {
    // Las direcciones llegan con la caja que las escriba cada proveedor; el
    // índice normaliza a minúsculas por los dos lados.
    const entries = compose({
      wallets: [wallet({ address: 'AbCdEf' })],
      transfers: [transfer({ source: { fromAddress: 'abcdef' } })],
    });

    expect(entries[0]?.transfers).toHaveLength(1);
  });

  it('no duplica la transferencia que el cliente reclama por varias claves a la vez', () => {
    /*
     * El caso que rompe una implementación ingenua: la misma transferencia sale
     * de una billetera del cliente Y entra en otra suya, además de venir con su
     * `onBehalfOf`. Son tres índices apuntando al mismo objeto y tiene que
     * contarse una vez.
     */
    const entries = compose({
      wallets: [wallet({ idWallet: 'w-1', address: 'ADDR-1' }), wallet({ idWallet: 'w-2', address: 'ADDR-2' })],
      transfers: [
        transfer({
          onBehalfOf: 'bridge-100',
          source: { bridgeWalletId: 'w-1', fromAddress: 'ADDR-1' },
          destination: { bridgeWalletId: 'w-2', toAddress: 'ADDR-2' },
        }),
      ],
    });

    expect(entries[0]?.transfers).toHaveLength(1);
  });

  it('no le atribuye transferencias de otro cliente', () => {
    const entries = compose({
      wallets: [wallet()],
      transfers: [transfer({ onBehalfOf: 'bridge-999', source: { bridgeWalletId: 'w-999' } })],
    });

    expect(entries[0]?.transfers).toEqual([]);
  });
});

describe('composeFinturuDirectory: cruce con Stripe', () => {
  const stripe = (over: Partial<FinturuStripeCustomerDto> = {}): FinturuStripeCustomerDto => ({
    idCustomer: 'cus_ABC',
    email: 'v@example.com',
    ...over,
  });

  it('cruza por correo, ignorando caja y espacios', () => {
    const entries = compose({ stripeCustomers: [stripe({ email: '  V@Example.com ' })] });

    expect(entries[0]?.idCustomer).toBe('cus_ABC');
    expect(entries[0]?.stripe).not.toBeNull();
  });

  it('cruza por idUserFinturu, que es el enganche directo', () => {
    /*
     * El camino que de verdad funciona hoy. `name`, `email` y `metadata` salen
     * de `account.requestBody` en api-business, que está vacío para todas las
     * cuentas: por eso llegan nulos y por eso el cruce daba cero antes de mirar
     * este campo.
     */
    const entries = compose({ stripeCustomers: [{ idCustomer: 'acct_X', idUserFinturu: 100 }] });

    expect(entries[0]?.idCustomer).toBe('acct_X');
    expect(entries[0]?.stripe).not.toBeNull();
  });

  it('acepta idUserFinturu como número o como cadena', () => {
    const comoNumero = compose({ stripeCustomers: [{ idCustomer: 'acct_N', idUserFinturu: 100 }] });
    const comoTexto = compose({ stripeCustomers: [{ idCustomer: 'acct_T', idUserFinturu: '100' }] });

    expect(comoNumero[0]?.idCustomer).toBe('acct_N');
    expect(comoTexto[0]?.idCustomer).toBe('acct_T');
  });

  it('cruza por userInfo.idUser cuando idUserFinturu no viene', () => {
    const entries = compose({
      stripeCustomers: [{ idCustomer: 'acct_U', userInfo: { idUser: 100, names: 'Valentina' } }],
    });

    expect(entries[0]?.idCustomer).toBe('acct_U');
  });

  it('cruza por userInfo.email cuando no hay identificador', () => {
    const entries = compose({
      stripeCustomers: [{ idCustomer: 'acct_E', userInfo: { email: 'V@Example.com' } }],
    });

    expect(entries[0]?.idCustomer).toBe('acct_E');
  });

  it('no cruza cuando el userInfo apunta a otro usuario', () => {
    const entries = compose({
      stripeCustomers: [{ idCustomer: 'acct_Z', idUserFinturu: 999, userInfo: { idUser: 999 } }],
    });

    expect(entries[0]?.stripe).toBeNull();
    expect(entries[0]?.idCustomer).toBeNull();
  });

  it('cruza por idUser dentro de metadata cuando el correo no coincide', () => {
    const entries = compose({
      stripeCustomers: [stripe({ email: 'otro@example.com', metadata: { idUser: '100' } })],
    });

    expect(entries[0]?.idCustomer).toBe('cus_ABC');
  });

  it('cruza aunque metadata traiga el identificador como número', () => {
    /*
     * El padrón tipa el MISMO campo como número en unos payloads y como cadena
     * en otros. Descartar la variante numérica dejaba sin cruzar a la mitad de
     * los clientes, que es el bug que documenta `readKey`.
     */
    const entries = compose({
      stripeCustomers: [stripe({ email: 'otro@example.com', metadata: { idUser: 100 } })],
    });

    expect(entries[0]?.idCustomer).toBe('cus_ABC');
  });

  it('deja stripe en null cuando no hay con quién cruzar', () => {
    const entries = compose({ stripeCustomers: [stripe({ email: 'nadie@example.com' })] });

    expect(entries[0]?.stripe).toBeNull();
    expect(entries[0]?.idCustomer).toBeNull();
  });

  it('devuelve los movimientos de Stripe vacíos', () => {
    // `/stripe/transfers` responde 404 en el Finturu actual, así que el campo
    // se sirve vacío a propósito en vez de con una llamada muerta detrás.
    const entries = compose({ stripeCustomers: [stripe()] });

    expect((entries[0]?.stripe as Record<string, unknown>).transfers).toEqual([]);
  });
});

describe('composeFinturuDirectory: puntuación de riesgo', () => {
  it('sube la puntuación del cliente suspendido', () => {
    const base = compose()[0]!.riskScore;
    const suspended = compose({ customers: [customer({ status: 'suspended' })] })[0]!.riskScore;

    expect(suspended).toBeGreaterThan(base);
  });

  it('sube la puntuación cuando hay transferencias fallidas o devueltas', () => {
    const base = compose()[0]!.riskScore;
    const failed = compose({
      transfers: [transfer({ onBehalfOf: 'bridge-100', state: 'failed' })],
    })[0]!.riskScore;

    expect(failed).toBeGreaterThan(base);
  });

  it('nunca se sale de la banda 10-99', () => {
    const worst = compose({
      customers: [customer({ status: 'blocked' })],
      wallets: [wallet()],
      transfers: Array.from({ length: 10 }, (_, i) =>
        transfer({ idTransfer: `t-${i}`, onBehalfOf: 'bridge-100', state: 'returned' }),
      ),
    })[0]!.riskScore;

    expect(worst).toBeLessThanOrEqual(99);
    expect(worst).toBeGreaterThanOrEqual(10);
  });
});
