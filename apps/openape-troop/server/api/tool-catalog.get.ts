import catalog from '../tool-catalog.json'

// Public read of the tool catalog. The UI fetches this to populate
// the per-task tool picker; agents (and curious humans) can inspect
// it too. No auth required — the list is the same for everybody and
// non-secret.
export default defineEventHandler(() => catalog)
