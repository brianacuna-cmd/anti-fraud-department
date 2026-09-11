import type { ObjectId } from 'mongodb';

export interface FieldMutationDocument {
  readonly field: string;
  readonly previous_value: unknown;
  readonly new_value: unknown;
}

/** Forma Mongo de `entity_change_log` (AUD-001). */
export interface EntityChangeDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly mutations: readonly FieldMutationDocument[];
  readonly created_at: Date;
}
