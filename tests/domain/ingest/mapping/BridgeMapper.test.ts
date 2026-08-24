import { mapBridgeEnvelope } from '../../../../src/modules/ingest/infrastructure/adapters/outbound/mapping/BridgeMapper.js';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function bridgeEvent(eventType: string, eventObject: Record<string, unknown>) {
  return {
    event_id: `wh_${eventType.replace(/\./g, '_')}`,
    event_type: eventType,
    event_created_at: CREATED_AT,
    event_object: eventObject,
  };
}

describe('mapBridgeEnvelope', () => {
  it('converts decimal amount "1500.00" to amountCents 150000 for card_transaction.created', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.created', {
        amount: '1500.00',
        currency: 'usd',
        customer_id: 'cust_bridge',
        status: 'approved',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.provider).toBe('bridge');
    expect(result.event.providerEventType).toBe('card_transaction.created');
    expect(result.event.providerEventId).toBe('wh_card_transaction_created');
    expect(result.event.amountCents).toBe(150000);
    expect(result.event.caseCustomerId).toBe('cust_bridge');
    expect(result.event.currency).toBe('USD');
    expect(result.event.riskSignals.status).toBe('approved');
    expect(result.event).not.toHaveProperty('riskScore');
    expect(result.event.riskSignals).not.toHaveProperty('stripeRiskScore');
  });

  it('maps transfer.created using on_behalf_of when customer_id is absent', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('transfer.created', {
        amount: '10.50',
        currency: 'usd',
        on_behalf_of: 'cust_obo',
        status: 'completed',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.providerEventType).toBe('transfer.created');
    expect(result.event.amountCents).toBe(1050);
    expect(result.event.caseCustomerId).toBe('cust_obo');
    expect(result.event).not.toHaveProperty('riskScore');
  });

  it('maps card_transaction.updated.status_transitioned without inventing a fraud percent', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.updated.status_transitioned', {
        amount: '0.01',
        currency: 'eur',
        customer_id: 'cust_tx',
        status: 'declined',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.amountCents).toBe(1);
    expect(result.event.currency).toBe('EUR');
    expect(result.event.riskSignals.status).toBe('declined');
    expect(Object.keys(result.event.riskSignals).some((key) => /score|percent/i.test(key))).toBe(
      false,
    );
  });

  it('returns failed for an unparsable amount string', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.created', {
        amount: 'not-money',
        currency: 'usd',
        customer_id: 'cust_bridge',
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('unparsable_amount');
  });

  it('returns failed when amount has more than two decimal places', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('transfer.created', {
        amount: '10.555',
        currency: 'usd',
        on_behalf_of: 'cust_obo',
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('unparsable_amount');
  });

  it('returns failed when customer_id and on_behalf_of are missing', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.updated', {
        amount: '1.00',
        currency: 'usd',
      }),
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed');
    }
    expect(result.reason).toBe('missing_customer');
  });

  it('populates subjectIdentity with entryType WALLET when a wallet_address is present', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.created', {
        amount: '1500.00',
        currency: 'usd',
        customer_id: 'cust_bridge',
        status: 'approved',
        customer_name: 'Juan Rios',
        customer_document_id: 'DOC-1',
        wallet_address: '0xabc123',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.subjectIdentity).toEqual({
      nombre: 'Juan Rios',
      documento: 'DOC-1',
      walletAddress: '0xabc123',
      entryType: 'WALLET',
    });
  });

  it('leaves subjectIdentity undefined when no identity fields are present', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('card_transaction.created', {
        amount: '1500.00',
        currency: 'usd',
        customer_id: 'cust_bridge',
        status: 'approved',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.subjectIdentity).toBeUndefined();
  });

  it('prefers customer_id over on_behalf_of', () => {
    const result = mapBridgeEnvelope(
      bridgeEvent('transfer.updated', {
        amount: '2.00',
        currency: 'usd',
        customer_id: 'cust_primary',
        on_behalf_of: 'cust_obo',
      }),
    );

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') {
      throw new Error('expected mapped');
    }
    expect(result.event.caseCustomerId).toBe('cust_primary');
  });
});
