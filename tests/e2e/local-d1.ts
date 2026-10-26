/**
 * Where the end-to-end `wrangler dev` keeps its local D1, KV and R2 state.
 * Kept apart from the default `.wrangler/state`, so tests never touch a
 * developer's own local data, and emptied before each run.
 */
export const E2E_PERSIST_DIR = '.wrangler/e2e-state'
