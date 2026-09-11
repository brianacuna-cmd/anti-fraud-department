/**
 * Outbound port — the organizations an official list is materialized into.
 *
 * Screening cannot import identity-access, so the composition root bridges
 * this to the organization repository.
 */
export interface ActiveOrganizationSource {
  listActiveOrganizationIds(): Promise<readonly string[]>;
}
