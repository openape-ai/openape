import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { resolveEndpoint } from '../config.ts'
import { info, printLine } from '../output.ts'

/**
 * Open timetrack.openape.ai in the default browser. Headless environments
 * get the URL printed instead.
 */
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Open timetrack.openape.ai in the default browser.' },
  args: {
    'print-only': { type: 'boolean', description: 'Print the URL without launching a browser.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const url = resolveEndpoint(args.endpoint)
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
