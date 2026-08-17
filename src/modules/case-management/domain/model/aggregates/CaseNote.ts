import type { Instant } from '../../../../../shared/time/Instant.js';
import type { CaseId } from '../value-objects/CaseId.js';
import type { CaseNoteId } from '../value-objects/CaseNoteId.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export interface CaseNoteProps {
  readonly id: CaseNoteId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: Instant;
}

export interface CreateCaseNoteInput {
  readonly id: CaseNoteId;
  readonly caseId: CaseId;
  readonly organizationId: string;
  readonly authorId: string;
  readonly body: string;
  readonly now: Instant;
}

/**
 * Free-text note attached to a case (append-only, like the timeline). No
 * edit/delete: a correction is a new note. Emitted alongside a `NOTE_ADDED`
 * timeline event by `AddCaseNote`.
 */
export class CaseNote {
  private constructor(private readonly props: CaseNoteProps) {}

  static create(input: CreateCaseNoteInput): CaseNote {
    const body = input.body.trim();
    if (body.length === 0) {
      throw invariantViolation('CaseNote body must be a non-empty string', { field: 'body' });
    }
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('authorId', input.authorId);
    return new CaseNote({
      id: input.id,
      caseId: input.caseId,
      organizationId: input.organizationId,
      authorId: input.authorId,
      body,
      createdAt: input.now,
    });
  }

  static rehydrate(props: CaseNoteProps): CaseNote {
    return new CaseNote(props);
  }

  get id(): CaseNoteId {
    return this.props.id;
  }

  get caseId(): CaseId {
    return this.props.caseId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get authorId(): string {
    return this.props.authorId;
  }

  get body(): string {
    return this.props.body;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`CaseNote ${field} must be a non-empty string`, { field, value });
  }
}
