import { InMemoryRoleRepository, buildRoleView, withRoles } from '../../../helpers/identity-access/InMemoryRoleRepository.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

describe('RoleRepository (port contract, via InMemoryRoleRepository fake)', () => {
  it('findById returns a known seeded role', async () => {
    const repository = new InMemoryRoleRepository();

    const found = await repository.findById(createRoleId('SUPERVISOR'));

    expect(found?.id).toBe('SUPERVISOR');
    expect(found?.status).toBe('ACTIVE');
  });

  it('findById returns null for a role not present in the catalog', async () => {
    const repository = withRoles([buildRoleView('ADMIN')]);

    const found = await repository.findById(createRoleId('SUPERVISOR'));

    expect(found).toBeNull();
  });

  it('exists() reflects catalog membership', async () => {
    const repository = withRoles([buildRoleView('ADMIN')]);

    expect(await repository.exists(createRoleId('ADMIN'))).toBe(true);
    expect(await repository.exists(createRoleId('SUPERVISOR'))).toBe(false);
  });

  it.each(['SUPERVISOR', 'ANALYST', 'AUDITOR'])('isAssignableToUser is true for the seeded, ACTIVE role "%s"', async (roleId) => {
    const repository = new InMemoryRoleRepository();

    expect(await repository.isAssignableToUser(createRoleId(roleId))).toBe(true);
  });

  it('isAssignableToUser is false for ADMIN even when it is a seeded, ACTIVE role', async () => {
    const repository = new InMemoryRoleRepository();

    expect(await repository.isAssignableToUser(createRoleId('ADMIN'))).toBe(false);
  });

  it('isAssignableToUser is false for an INACTIVE role', async () => {
    const repository = withRoles([buildRoleView('SUPERVISOR', { status: 'INACTIVE' })]);

    expect(await repository.isAssignableToUser(createRoleId('SUPERVISOR'))).toBe(false);
  });

  it('isAssignableToUser is false for a soft-deleted role', async () => {
    const repository = withRoles([buildRoleView('SUPERVISOR', { deletedAt: fromDate(new Date('2026-01-01T00:00:00.000Z')) })]);

    expect(await repository.isAssignableToUser(createRoleId('SUPERVISOR'))).toBe(false);
  });
});
