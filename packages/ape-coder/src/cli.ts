import { defineCommand, runMain } from 'citty'
import consola from 'consola'
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth'
import { projectsCommand } from './commands/projects'
import { storiesCommand } from './commands/stories'
import { syncCommand } from './commands/sync'
import { CliError } from './errors'

// Gracefully handle EPIPE when stdout is closed early (e.g. piped to `head`).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

declare const __VERSION__: string

const main = defineCommand({
  meta: {
    name: 'ape-coder',
    version: __VERSION__,
    description: 'CLI for coder.openape.ai — projects and user-stories from the terminal, plus client-side repo sync. Authenticates via `apes login` SSO; same permissions as the app.',
  },
  subCommands: {
    projects: projectsCommand,
    stories: storiesCommand,
    sync: syncCommand,
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
