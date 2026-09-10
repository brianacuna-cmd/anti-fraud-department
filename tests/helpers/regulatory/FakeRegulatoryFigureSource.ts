import type {
  FigureQuery,
  RegulatoryFigureSource,
} from '../../../src/modules/regulatory/domain/ports/RegulatoryFigureSource.js';
import type { RegulatoryFigures } from '../../../src/modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';
import { EMPTY_FIGURES } from '../../../src/modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';

export class FakeRegulatoryFigureSource implements RegulatoryFigureSource {
  private next: RegulatoryFigures = EMPTY_FIGURES;
  private readonly queries: FigureQuery[] = [];

  returns(figures: Partial<RegulatoryFigures>): void {
    this.next = { ...EMPTY_FIGURES, ...figures } as RegulatoryFigures;
  }

  async compute(query: FigureQuery): Promise<RegulatoryFigures> {
    this.queries.push(query);
    return this.next;
  }

  asked(): readonly FigureQuery[] {
    return this.queries;
  }
}
