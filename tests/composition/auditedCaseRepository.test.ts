import { oid } from '../support/oid.js';
import { createAuditedCaseRepository } from '../../src/composition/auditedCaseRepository.js';
import type { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import type {
  CaseListResult,
  CaseRepository,
} from '../../src/modules/case-management/domain/ports/CaseRepository.js';
import type { createRecordEntityChangeUseCase } from '../../src/modules/audit/application/RecordEntityChange.js';

/**
 * El doble es una CLASE a proposito.
 *
 * La produccion inyecta `MongoCaseRepository`, que tambien lo es, y ahi estuvo
 * el fallo que este fichero fija: los metodos de una clase viven en el
 * prototipo, asi que el `{ ...inner }` que tenia el decorador no copiaba
 * ninguno y el repositorio decorado salia con un unico metodo propio, `save`.
 * Un doble escrito como objeto literal —lo comodo— tiene sus metodos como
 * propiedades propias, el spread si los copia, y el test pasaria en verde
 * sobre el mismo codigo roto.
 */
class FakeCaseRepository implements CaseRepository {
  readonly llamadas: string[] = [];

  async save(): Promise<void> {
    this.llamadas.push('save');
  }

  async findById(): Promise<Case | null> {
    this.llamadas.push('findById');
    return null;
  }

  async findByIdempotencyKey(): Promise<Case | null> {
    this.llamadas.push('findByIdempotencyKey');
    return null;
  }

  async list(): Promise<CaseListResult> {
    this.llamadas.push('list');
    return { items: [], total: 0 };
  }

  async findByCustomerOrBridgeId(): Promise<Case | null> {
    this.llamadas.push('findByCustomerOrBridgeId');
    return null;
  }

  async findByEntityIdentifiers(): Promise<readonly Case[]> {
    this.llamadas.push('findByEntityIdentifiers');
    return [];
  }
}

/** Mongo solo hace falta para el `save`; los metodos de lectura no lo tocan. */
const dbQueNoSeUsa = {
  collection: () => ({
    findOne: async () => null,
  }),
} as never;

const recordEntityChange = (async () => {}) as unknown as ReturnType<
  typeof createRecordEntityChangeUseCase
>;

function decorar(inner: CaseRepository) {
  return createAuditedCaseRepository(inner, dbQueNoSeUsa, recordEntityChange, () => null);
}

describe('createAuditedCaseRepository', () => {
  /*
   * Esta es la regresion. En produccion salio como
   * `TypeError: deps.cases.list is not a function` al listar casos y al abrir
   * el directorio de Finturu: la auditoria no rompio el guardado, rompio todo
   * lo demas. Se comprueba metodo a metodo, y no solo `list`, porque el fallo
   * no era de un metodo concreto sino de la forma de delegar: con el spread
   * faltaban los cinco.
   */
  it('expone todos los metodos de lectura del puerto, no solo save', async () => {
    const inner = new FakeCaseRepository();
    const repo = decorar(inner);

    await repo.findById(oid('case-1') as never);
    await repo.findByIdempotencyKey(oid('org-1'), 'idem-1');
    await repo.list({ organizationId: oid('org-1'), limit: 10, offset: 0 });
    await repo.findByCustomerOrBridgeId({ organizationId: oid('org-1') });
    await repo.findByEntityIdentifiers({ organizationId: oid('org-1'), refs: [], limit: 10 });

    expect(inner.llamadas).toEqual([
      'findById',
      'findByIdempotencyKey',
      'list',
      'findByCustomerOrBridgeId',
      'findByEntityIdentifiers',
    ]);
  });

  it('conserva el `this` del repositorio envuelto', async () => {
    // `MongoCaseRepository` guarda su coleccion en un campo de instancia, asi
    // que una referencia al metodo sin enlazar compilaria y fallaria al usarse.
    const inner = new FakeCaseRepository();
    const { list } = decorar(inner);

    await expect(list({ organizationId: oid('org-1'), limit: 10, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});
