import { defineCommand, runMain } from 'citty'
import consola from 'consola'
import { agentsCommand } from './commands/agents'
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth'
import { nestsCommand } from './commands/nests'
import { CliError } from './errors'

// Gracefully handle EPIPE when stdout is closed early (e.g. piped to `head`).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

declare const __VERSION__: string

const main = defineCommand({
  meta: {
    name: 'ape-troop',
    version: __VERSION__,
    description: 'Owner CLI for troop.openape.ai — manage bound devices (nests) and agents. Authenticates via `apes login` SSO.',
  },
  subCommands: {
    nests: nestsCommand,
    agents: agentsCommand,
    whoami: whoamiCommand,
    login: loginCommand,
    logout: logoutCommand,
  },
})

runMain(main).catch((err: unknown) => {
  if (err instanceof CliError) {
    consola.error(err.message)
    process.exit(err.exitCode)
  }
  consola.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
