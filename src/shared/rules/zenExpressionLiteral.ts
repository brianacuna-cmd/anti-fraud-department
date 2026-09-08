/**
 * Quotes a value for the ZEN/JDM expression language, escaping embedded
 * quotes/backslashes. Shared by every guided rule-builder use case
 * (`CreatePriorityAssignmentRule.ts`, ...) that compiles a simple input
 * form into a decision-table JDM graph — kept here rather than duplicated
 * per module since it is pure ZEN-syntax formatting, not domain logic.
 */
export function zenExpressionLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
