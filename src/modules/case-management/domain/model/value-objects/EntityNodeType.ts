import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * Los identificadores por los que dos expedientes pueden resultar ser la
 * misma red.
 *
 * No es `InvestigationSubjectType` ampliado por comodidad. Aquel es el
 * catálogo de lo que un analista puede *elegir* investigar (WALLET, EMAIL,
 * CUSTOMER); este es el de lo que la ingesta sabe *normalizar* de Finturu, y
 * son cosas distintas: `BRIDGE_USER` y `STRIPE_CUSTOMER` conectan casos con
 * mucha más precisión que un email —son claves de proveedor, no texto que el
 * defraudador escribe— pero a nadie se le ocurre abrir una investigación
 * "sobre un id de Stripe". Mezclarlos obligaría a uno de los dos a admitir
 * valores que no le corresponden.
 */
export type EntityNodeType = 'CUSTOMER' | 'EMAIL' | 'WALLET' | 'BRIDGE_USER' | 'STRIPE_CUSTOMER';

export const ENTITY_NODE_TYPES = [
  'CUSTOMER',
  'EMAIL',
  'WALLET',
  'BRIDGE_USER',
  'STRIPE_CUSTOMER',
] as const;

const VALID: ReadonlySet<string> = new Set<EntityNodeType>(ENTITY_NODE_TYPES);

export function createEntityNodeType(value: string): EntityNodeType {
  if (!VALID.has(value)) {
    throw invariantViolation(`EntityNodeType must be one of ${ENTITY_NODE_TYPES.join(', ')}`, { value });
  }
  return value as EntityNodeType;
}

/**
 * Traduce el tipo de sujeto de una investigación al nodo del grafo por el que
 * hay que empezar a tirar.
 *
 * El mapa es total sobre `InvestigationSubjectType` a propósito: si mañana el
 * catálogo de sujetos crece, el `switch` deja de compilar y alguien tiene que
 * decidir por qué identificador se expande, en vez de que la investigación
 * nueva devuelva un grafo vacío sin que nadie se entere.
 */
export function entityNodeTypeForSubject(subjectType: 'WALLET' | 'EMAIL' | 'CUSTOMER'): EntityNodeType {
  switch (subjectType) {
    case 'WALLET':
      return 'WALLET';
    case 'EMAIL':
      return 'EMAIL';
    case 'CUSTOMER':
      return 'CUSTOMER';
  }
}

/**
 * Forma canónica de un identificador, para que dos escrituras del mismo dato
 * caigan en el mismo nodo.
 *
 * El email se pasa a minúsculas porque `Fraude@X.com` y `fraude@x.com` son el
 * mismo buzón y quien abre cuentas en serie lo sabe. El resto solo se recorta:
 * una wallet EVM se escribe en checksum-case a propósito (EIP-55) y un id de
 * Bridge o Stripe es opaco, así que bajarlos a minúsculas sería inventarse una
 * equivalencia que el proveedor no garantiza.
 */
export function normalizeEntityValue(type: EntityNodeType, value: string): string {
  const trimmed = value.trim();
  return type === 'EMAIL' ? trimmed.toLowerCase() : trimmed;
}

/** Clave estable `TIPO:valor`, para deduplicar nodos y como id en el JSON de salida. */
export function entityNodeKey(type: EntityNodeType, value: string): string {
  return `${type}:${normalizeEntityValue(type, value)}`;
}

/**
 * Un identificador concreto: el tipo y su valor ya canonizado.
 *
 * Vive aquí y no junto al motor de grafo porque `CaseRepository` lo usa en la
 * firma de `findByEntityIdentifiers`, y un puerto del dominio no puede
 * depender de un servicio del dominio sin invertir la relación.
 */
export interface EntityRef {
  readonly type: EntityNodeType;
  readonly value: string;
}
