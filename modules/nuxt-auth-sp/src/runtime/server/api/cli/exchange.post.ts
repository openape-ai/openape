import { createCliExchangeHandler } from '../../utils/cli-exchange'

// POST /api/cli/exchange — registered via addServerHandler for every SP app.
// The entire exchange lives in createCliExchangeHandler (utils/cli-exchange)
// so there is exactly ONE implementation: this route, and any app-level
// `export default createCliExchangeHandler()` alias, serve identical code.
// #1043: a second, diverging in-module implementation here is what silently
// shadowed troop's app handler and kept its hardening out of production.
export default createCliExchangeHandler()
