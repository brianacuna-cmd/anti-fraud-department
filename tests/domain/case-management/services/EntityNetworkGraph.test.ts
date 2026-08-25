import { oid } from '../../../support/oid.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import {
  EntityNetworkGraphBuilder,
  entityIdentifiersOf,
  MAX_GRAPH_NODES,
} from '../../../../src/modules/case-management/domain/services/EntityNetworkGraph.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');

let seq = 0;
function buildCase(
  overrides: {
    customerId?: string;
    customerEmail?: string | null;
    bridgeWallet?: string | null;
    bridgeUserId?: string | null;
    stripeCustomerId?: string | null;
  } = {},
): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-${seq}`)),
    organizationId: ORG,
    customerId: overrides.customerId ?? `customer-${seq}`,
    customerEmail: overrides.customerEmail ?? null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    bridgeUserId: overrides.bridgeUserId ?? null,
    stripeCustomerId: overrides.stripeCustomerId ?? null,
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
}

describe('entityIdentifiersOf', () => {
  it('reúne los cinco identificadores normalizados del expediente', () => {
    const kase = buildCase({
      customerId: 'cus-1',
      customerEmail: 'Fraude@Example.COM',
      bridgeWallet: '0xAbC',
      bridgeUserId: 'bru-1',
      stripeCustomerId: 'cus_stripe_1',
    });

    expect(entityIdentifiersOf(kase)).toEqual([
      { type: 'CUSTOMER', value: 'cus-1' },
      // Email is lowercased; the wallet keeps the EIP-55 checksum case.
      { type: 'EMAIL', value: 'fraude@example.com' },
      { type: 'WALLET', value: '0xAbC' },
      { type: 'BRIDGE_USER', value: 'bru-1' },
      { type: 'STRIPE_CUSTOMER', value: 'cus_stripe_1' },
    ]);
  });

  it('descarta los identificadores ausentes y los que solo traen espacios', () => {
    const kase = buildCase({ customerId: 'cus-1', customerEmail: '   ', bridgeWallet: null });

    // A blank email would group every caseless-email case under one node.
    expect(entityIdentifiersOf(kase)).toEqual([{ type: 'CUSTOMER', value: 'cus-1' }]);
  });
});

describe('EntityNetworkGraphBuilder', () => {
  it('rechaza una profundidad no positiva', () => {
    expect(() => new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 0)).toThrow(
      CaseManagementError,
    );
  });

  it('rechaza una raíz vacía', () => {
    expect(() => new EntityNetworkGraphBuilder({ type: 'WALLET', value: '  ' }, 3)).toThrow(
      CaseManagementError,
    );
  });

  it('arranca con la raíz como único nodo, a profundidad 0', () => {
    const builder = new EntityNetworkGraphBuilder({ type: 'EMAIL', value: 'A@B.com' }, 3);

    expect(builder.frontier()).toEqual([{ type: 'EMAIL', value: 'a@b.com' }]);
    const graph = builder.build([]);
    expect(graph.rootId).toBe('EMAIL:a@b.com');
    expect(graph.nodes).toEqual([
      { kind: 'ENTITY', id: 'EMAIL:a@b.com', type: 'EMAIL', value: 'a@b.com', depth: 0 },
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.depthReached).toBe(0);
    expect(graph.truncated).toBe(false);
  });

  it('conecta dos expedientes a través del identificador que comparten', () => {
    const shared = '0xshared';
    const a = buildCase({ customerId: 'cus-a', bridgeWallet: shared });
    const b = buildCase({ customerId: 'cus-b', bridgeWallet: shared });

    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: shared }, 3);
    const next = builder.absorb([a, b], 1);
    const graph = builder.build(next);

    // The wallet is the bridge: each case hangs off it, and the path
    // case A → wallet → case B is explicit with no case-to-case edge.
    expect(graph.edges).toContainEqual({
      from: `CASE:${a.id}`,
      to: `WALLET:${shared}`,
      type: 'WALLET',
    });
    expect(graph.edges).toContainEqual({
      from: `CASE:${b.id}`,
      to: `WALLET:${shared}`,
      type: 'WALLET',
    });
    expect(graph.edges.some((edge) => edge.from.startsWith('CASE:') && edge.to.startsWith('CASE:'))).toBe(
      false,
    );

    // Each case's own customerId enters as the next frontier.
    expect(next).toEqual([
      { type: 'CUSTOMER', value: 'cus-a' },
      { type: 'CUSTOMER', value: 'cus-b' },
    ]);
  });

  it('no devuelve al frente un identificador ya visitado', () => {
    const shared = '0xshared';
    const a = buildCase({ customerId: 'cus-a', bridgeWallet: shared });

    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: shared }, 3);
    const next = builder.absorb([a], 1);

    // The root was already visited: if it returned to the frontier, the next
    // round would repeat the same query and the walk would never finish.
    expect(next).not.toContainEqual({ type: 'WALLET', value: shared });
  });

  it('deduplica nodos y aristas cuando el mismo caso llega dos veces', () => {
    const kase = buildCase({ customerId: 'cus-a', bridgeWallet: '0xabc' });

    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 3);
    builder.absorb([kase], 1);
    builder.absorb([kase], 2);
    const graph = builder.build([]);

    expect(graph.nodes.filter((node) => node.id === `CASE:${kase.id}`)).toHaveLength(1);
    expect(graph.edges).toHaveLength(2); // wallet + customer, once each
  });

  it('conserva la profundidad del primer descubrimiento', () => {
    const first = buildCase({ customerId: 'cus-a', bridgeWallet: '0xabc' });
    const second = buildCase({ customerId: 'cus-b', bridgeWallet: '0xabc' });

    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 3);
    builder.absorb([first], 1);
    builder.absorb([second], 2);
    const graph = builder.build([]);

    const nodeFor = (id: string) => graph.nodes.find((node) => node.id === id);
    expect(nodeFor(`CASE:${first.id}`)?.depth).toBe(1);
    expect(nodeFor(`CASE:${second.id}`)?.depth).toBe(2);
    expect(graph.depthReached).toBe(2);
  });

  it('rechaza una ronda fuera de 1..maxDepth', () => {
    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 2);

    expect(() => builder.absorb([], 0)).toThrow(CaseManagementError);
    expect(() => builder.absorb([], 3)).toThrow(CaseManagementError);
  });

  it('marca truncated cuando queda frente sin expandir', () => {
    const kase = buildCase({ customerId: 'cus-a', bridgeWallet: '0xabc' });
    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 1);
    const next = builder.absorb([kase], 1);

    // Rounds ran out but `cus-a` was still unexplored: the graph is a
    // cut, and reading it as a complete network would be a false conclusion.
    expect(next.length).toBeGreaterThan(0);
    expect(builder.build(next).truncated).toBe(true);
  });

  it('no marca truncated cuando la red se agota sola', () => {
    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 3);
    const next = builder.absorb([], 1);

    expect(next).toEqual([]);
    expect(builder.build(next).truncated).toBe(false);
  });

  it('corta en el techo de nodos y lo marca como truncado', () => {
    // Each case contributes 2 nodes (the case and its customerId), so with
    // slack over the ceiling the expansion has to stop itself.
    const many = Array.from({ length: MAX_GRAPH_NODES }, (_, i) =>
      buildCase({ customerId: `cus-${i}`, bridgeWallet: '0xabc' }),
    );

    const builder = new EntityNetworkGraphBuilder({ type: 'WALLET', value: '0xabc' }, 3);
    const next = builder.absorb(many, 1);
    const graph = builder.build(next);

    expect(graph.nodes.length).toBeLessThanOrEqual(MAX_GRAPH_NODES);
    expect(graph.truncated).toBe(true);
  });
});
