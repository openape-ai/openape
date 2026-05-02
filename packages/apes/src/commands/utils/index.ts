import { defineCommand } from 'citty'
import { digCommand } from './dig'

/**
 * `apes utils …` — admin/diagnostic utilities. Started with `dig` (DDISA
 * IdP resolution); intended home for future probes (token decoders,
 * config dumpers, version reporters, etc.) that don't fit into the
 * grants/agents/auth namespaces.
 */
export const utilsCommand = defineCommand({
  meta: {
    name: 'utils',
    description: 'Admin/diagnostic utilities (dig, …)',
  },
  subCommands: {
    dig: digCommand,
  },
})
