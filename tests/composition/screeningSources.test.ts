import {
  createFinturuScreeningCustomerSource,
  toScreeningCustomer,
} from '../../src/composition/finturuScreeningCustomerSource.js';
import { createActiveOrganizationSource } from '../../src/composition/activeOrganizationSource.js';

describe('toScreeningCustomer', () => {
  it('joins name and last name and maps business customers to ORGANIZATION', () => {
    expect(toScreeningCustomer({ idUser: 'u-1', idUserBridge: 'b-1', name: ' Juan ', lastname: 'Pérez ', type: 'individual' }))
      .toEqual({ customerId: 'u-1', name: 'Juan Pérez', entryType: 'PERSON' });
    expect(toScreeningCustomer({ idUser: 'u-2', name: 'Acme Trading LLC', type: 'business' }))
      .toEqual({ customerId: 'u-2', name: 'Acme Trading LLC', entryType: 'ORGANIZATION' });
  });

  it('identifies the customer the same way the wallet rescreen does: idUser, else the Bridge id', () => {
    expect(toScreeningCustomer({ idUserBridge: 'b-9', name: 'Ana' })?.customerId).toBe('b-9');
  });

  it('skips customers with nothing to screen or nobody to attach an alert to', () => {
    expect(toScreeningCustomer({ idUser: 'u-3', name: ' ', lastname: '' })).toBeNull();
    expect(toScreeningCustomer({ name: 'Nameless Id' })).toBeNull();
  });

  it('streams only the customers that can be screened', async () => {
    const source = createFinturuScreeningCustomerSource({
      getCustomers: async () => [{ idUser: 'u-1', name: 'Juan' }, { idUser: 'u-2' }, { idUser: 'u-3', name: 'Ana' }],
    });

    const seen: string[] = [];
    for await (const customer of source.streamCustomers()) seen.push(customer.customerId);

    expect(seen).toEqual(['u-1', 'u-3']);
  });
});

describe('createActiveOrganizationSource', () => {
  it('walks every page and keeps only ACTIVE organizations', async () => {
    const pages: Record<string, { items: unknown[]; nextCursor: string | null }> = {
      start: { items: [{ id: 'org-1', status: 'ACTIVE' }, { id: 'org-2', status: 'SUSPENDED' }], nextCursor: 'p2' },
      p2: { items: [{ id: 'org-3', status: 'ACTIVE' }, { id: 'org-4', status: 'CANCELLED' }], nextCursor: null },
    };
    const list = jest.fn(async (_limit: number, cursor?: string) => pages[cursor ?? 'start'] as never);

    await expect(createActiveOrganizationSource({ list }).listActiveOrganizationIds()).resolves.toEqual(['org-1', 'org-3']);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
