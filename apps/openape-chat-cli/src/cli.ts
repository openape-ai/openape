import { defineCommand, runMain } from 'citty'
import { ApiError } from './api'
import { roomsCommand } from './commands/rooms'
import { whoamiCommand } from './commands/whoami'

const VERSION = '0.1.0'

const main = defineCommand({
  meta: {
    name: 'ape-chat',
    version: VERSION,
    description: 'CLI for chat.openape.ai — talk to humans and agents from the shell',
  },
  subCommands: {
    whoami: whoamiCommand,
    rooms: roomsCommand,
  },
})

runMain(main).catch((err: unknown) => {
  if (err instanceof ApiError) {
    process.stderr.write(`error: ${err.message}\n`)
    if (err.status === 401) {
      process.stderr.write('hint: run `apes login <email>` and try again\n')
    }
    process.exit(1)
  }
  if (err && typeof err === 'object' && 'message' in err) {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    process.exit(1)
  }
  process.stderr.write(`error: ${String(err)}\n`)
  process.exit(1)
})
