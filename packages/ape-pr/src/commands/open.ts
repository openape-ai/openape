import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { resolveEndpoint } from '../client.ts'
import { info, printLine } from '../output.ts'

/**
 * Open a PR's review page in the default browser.
 *
 * EXAMPLE
 *   $ ape-pr open 01JX…
 *   https://pr.openape.ai/prs/01JX…
 *   (browser opens)
 */
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Open a PR’s review page in the default browser.' },
  args: {
    id: { type: 'positional', required: true, description: 'PR id.' },
    'print-only': { type: 'boolean', description: 'Print the URL without launching a browser.' },
    endpoint: { type: 'string', description: 'Override pr endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const base = endpoint && typeof endpoint === 'string' ? endpoint.replace(/\/$/, '') : 'https://pr.openape.ai'
    const url = `${base}/prs/${args.id}`
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
