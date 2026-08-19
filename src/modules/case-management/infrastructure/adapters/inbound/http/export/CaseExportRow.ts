import type { Case } from '../../../../../domain/model/aggregates/Case.js';

/**
 * Flat, presentation-ready projection of a `Case` for tabular export
 * (audit / ops). Decouples the format renderers (xlsx/pdf/json) from the
 * aggregate so they operate on plain rows and stay trivially testable.
 */
export interface CaseExportRow {
  readonly id: string;
  readonly status: string;
  readonly priority: string;
  readonly riskScore: number;
  readonly customerId: string;
  readonly customerEmail: string;
  readonly assignedToType: string;
  readonly assignedToId: string;
  readonly tags: string;
  readonly dueDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Ordered column definitions — single source of truth for headers + order. */
export const CASE_EXPORT_COLUMNS: ReadonlyArray<{ key: keyof CaseExportRow; header: string }> = [
  { key: 'id', header: 'Case ID' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'riskScore', header: 'Risk Score' },
  { key: 'customerId', header: 'Customer ID' },
  { key: 'customerEmail', header: 'Customer Email' },
  { key: 'assignedToType', header: 'Assigned Type' },
  { key: 'assignedToId', header: 'Assigned ID' },
  { key: 'tags', header: 'Tags' },
  { key: 'dueDate', header: 'Due Date' },
  { key: 'createdAt', header: 'Created At' },
  { key: 'updatedAt', header: 'Updated At' },
];

export function toCaseExportRow(kase: Case): CaseExportRow {
  return {
    id: kase.id,
    status: kase.status,
    priority: kase.priority,
    riskScore: kase.riskScore,
    customerId: kase.customerId,
    customerEmail: kase.customerEmail ?? '',
    assignedToType: kase.assignedTo?.type ?? '',
    assignedToId: kase.assignedTo?.id ?? '',
    tags: [...kase.tags].join(', '),
    dueDate: kase.dueDate ?? '',
    createdAt: kase.createdAt,
    updatedAt: kase.updatedAt,
  };
}
