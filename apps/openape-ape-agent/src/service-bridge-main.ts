import process from 'node:process'
import { runService } from './service-bridge'

// Entry point for the `ape-agent-service` binary. Kept separate from
// service-bridge.ts so tests can import `pollOnce` without booting the loop.
runService().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
