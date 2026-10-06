import process from 'node:process'
import { runService } from './service-bridge'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('ape-agent-service — OpenApe agent service\n')
  if (process.env.OPENAPE_ISSUE_REPORTING_ENABLED === '1') process.stdout.write('Report a problem: https://repos.openape.ai/report?product=apes\n')
  process.exit(0)
}

// Entry point for the `ape-agent-service` binary. Kept separate from
// service-bridge.ts so tests can import `pollOnce` without booting the loop.
runService().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
