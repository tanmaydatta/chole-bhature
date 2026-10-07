// The public teardown entry delegates to the verifier-owned controller state.
// No raw session registration or cleanup authority crosses this module boundary.
export { teardownMockStack } from './provision.mjs';
