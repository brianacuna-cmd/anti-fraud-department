import { createTransitionActor } from '../../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';

describe('createTransitionActor', () => {
  it('carries isPlatformAdmin=true for a platform-admin actor', () => {
    const actor = createTransitionActor(true);

    expect(actor.isPlatformAdmin).toBe(true);
  });

  it('carries isPlatformAdmin=false for a non-platform-admin actor', () => {
    const actor = createTransitionActor(false);

    expect(actor.isPlatformAdmin).toBe(false);
  });
});
