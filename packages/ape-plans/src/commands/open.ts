import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../config.ts'
import { info, printLine } from '../output.ts'

interface PlanRef { id: string, team_id: string }

/**
 * Open a plan in the web UI — resolves team_id and launches the platform's
 * default browser. Useful for humans mid-terminal-flow. Headless environments
 * (CI, remote shells) get the URL printed instead.
 *
 * EXAMPLE
 *   $ ape-plans open 01HXX...
 *   https://plans.openape.ai/teams/01HYY.../plans/01HXX...
 *   (browser opens)
 */
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Open a plan in the default browser.' },
  args: {
    planId: { type: 'positional', required: true, description: 'Plan ULID.' },
    'print-only': { type: 'boolean', description: 'Print the URL without launching a browser.' },
    endpoint: { type: 'string', description: 'Override plans endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const plan = await apiCall<PlanRef>('GET', `/api/plans/${args.planId}`, { endpoint })
    const url = `${endpoint}/teams/${plan.team_id}/plans/${plan.id}`
    printLine(url)
    if (args['print-only']) return

    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
    try {
      const child = spawn(opener, [url], { detached: true, stdio: 'ignore' })
      child.unref()
    }
    catch {
      info('(no graphical browser available; URL printed above)')
    }
  },
})
