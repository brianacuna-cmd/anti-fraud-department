import type { ScoringFactor } from '../src/modules/risk-assessment/domain/services/factorScoringJdm.js';

/** Versioned on purpose: a new name is what makes the scripts replace an older active version. */
export const FRAUD_RULES_NAME = 'Reglas antifraude de pagos y transferencias v2 (gana la más grave)';

/**
 * The department's payment (Stripe) and transfer (Bridge) fraud rules, from least to most severe. They
 * go into ONE scoring rule — an organization has a single active rule — with
 * `MAX`: the gravest rule that holds sets the score, and every rule that
 * holds stays in the case as evidence.
 */
export const FRAUD_RULE_FACTORS: readonly ScoringFactor[] = [
  {
    field: 'activity.distinctCardCountries24h',
    operator: 'GTE',
    value: 2,
    points: 60,
    reason: 'Regla 5 · Geo dispersa: intentos con tarjetas de 2+ países en 24 h',
  },
  {
    field: 'activity.merchantLinksWithRepeatedFailures',
    operator: 'GTE',
    value: 3,
    points: 75,
    reason: 'Regla 2 · Seller reincidente: 3+ links del comercio con 3+ intentos fallidos cada uno (30 días)',
  },
  {
    field: 'activity.failedAttempts10m',
    operator: 'GTE',
    value: 5,
    points: 80,
    reason: 'Regla 6 · Velocidad: 5+ intentos fallidos en 10 minutos',
  },
  {
    field: 'activity.linkSuspiciousDeclines',
    operator: 'GTE',
    value: 3,
    points: 85,
    reason: 'Regla 1 · Link expira: 3+ intentos fallidos con código de fraude en el mismo link',
  },
  {
    field: 'activity.linkDistinctCards',
    operator: 'GTE',
    value: 3,
    points: 90,
    reason: 'Regla 4 · Card testing: 3+ tarjetas distintas en el mismo link',
  },
  {
    field: 'activity.chargebacks90d',
    operator: 'GTE',
    value: 1,
    points: 95,
    reason: 'Regla 3 · Chargeback: 1+ chargeback en 90 días',
  },
  // Bridge (transferencias). Importes en centavos: 1.000.000 = 10.000 USD.
  {
    field: 'activity.distinctCounterparties7d',
    operator: 'GTE',
    value: 3,
    points: 60,
    reason: 'Bridge · Destinos distintos: transferencias a 3+ wallets o cuentas en 7 días',
  },
  {
    field: 'activity.transfers24h',
    operator: 'GTE',
    value: 5,
    points: 65,
    reason: 'Bridge · Ráfaga: 5+ transferencias entregadas en 24 h',
  },
  {
    field: 'activity.currentTransferCents',
    operator: 'GTE',
    value: 1_000_000,
    points: 70,
    reason: 'Bridge · Transferencia grande: 10.000 USD o más',
  },
  {
    field: 'activity.transferVolume24hCents',
    operator: 'GTE',
    value: 2_500_000,
    points: 75,
    reason: 'Bridge · Volumen diario: 25.000 USD o más transferidos en 24 h',
  },
  {
    field: 'activity.newCounterpartyTransferCents',
    operator: 'GTE',
    value: 500_000,
    points: 80,
    reason: 'Bridge · Destino nuevo: 5.000 USD o más a una wallet o cuenta nunca usada',
  },
];

export interface RuleSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface CreateFraudRulesOptions {
  /** Base of the authenticated API, e.g. `https://host/api/v1`. */
  readonly apiUrl: string;
  /** Access token of a SUPERVISOR of the organization. */
  readonly token: string;
  /** Without it nothing is written: the script only says what it would do. */
  readonly confirm: boolean;
  readonly fetch: FetchLike;
  readonly log: (line: string) => void;
}

export type CreateFraudRulesResult =
  | { readonly outcome: 'ALREADY_ACTIVE'; readonly ruleId: string }
  | { readonly outcome: 'DRY_RUN'; readonly currentActive: string | null }
  | { readonly outcome: 'ACTIVATED'; readonly ruleId: string; readonly replaced: string | null };

/**
 * Creates the rule through the API (same validation and audit trail as the
 * screen) and activates it. Idempotent: if a rule with this name is already
 * active, nothing happens. Activating RETIRES the rule in force, so without
 * `confirm` it only reports what it would replace.
 */
export async function runCreateFraudRules(options: CreateFraudRulesOptions): Promise<CreateFraudRulesResult> {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await options.fetch(`${options.apiUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${method} ${path} answered ${res.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  };

  const { items } = (await call('GET', '/risk-scoring-rules')) as { items: RuleSummary[] };
  const active = items.find((rule) => rule.status === 'ACTIVE') ?? null;
  if (active !== null && active.name === FRAUD_RULES_NAME) {
    options.log(`La regla ya está activa (${active.id}). No se cambia nada.`);
    return { outcome: 'ALREADY_ACTIVE', ruleId: active.id };
  }

  if (!options.confirm) {
    options.log(
      active === null
        ? 'No hay ninguna regla activa. Ejecuta con --confirm para crear y activar las reglas.'
        : `Regla activa ahora: "${active.name}" (${active.id}). Activar la nueva la RETIRA. Ejecuta con --confirm para seguir.`,
    );
    return { outcome: 'DRY_RUN', currentActive: active?.id ?? null };
  }

  const created = (await call('POST', '/risk-scoring-rules/factor-scoring', {
    name: FRAUD_RULES_NAME,
    combination: 'MAX',
    factors: FRAUD_RULE_FACTORS,
  })) as RuleSummary;
  options.log(`Regla creada (${created.id}), inactiva.`);

  await call('POST', `/risk-scoring-rules/${created.id}/activate`);
  options.log(`Regla activada${active === null ? '' : `; retirada "${active.name}"`}.`);
  return { outcome: 'ACTIVATED', ruleId: created.id, replaced: active?.id ?? null };
}
