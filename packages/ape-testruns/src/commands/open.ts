import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../client.ts'
import { info, printLine } from '../output.ts'

/**
 * Open a run's public report in the default browser.
 *
 * EXAMPLE
 *   $ ape-testruns open 01JX…
 *   https://testrun.openape.ai/r/8fK2…
 *   (browser opens)
 */
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Open a run’s public report in the default browser.' },
  args: {
    id: { type: 'positional', required: true, description: 'Run ULID.' },
    'print-only': { type: 'boolean', description: 'Print the URL without launching a browser.' },
    endpoint: { type: 'string', description: 'Override testrun endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const run = await apiCall<{ url: string }>('GET', `/api/runs/${args.id}`, { endpoint })
    printLine(run.url)
    if (args['print-only']) return

    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
    try {
      const child = spawn(opener, [run.url], { detached: true, stdio: 'ignore' })
      child.unref()
    }
    catch {
      info('(no graphical browser available; URL printed above)')
    }
  },
})
