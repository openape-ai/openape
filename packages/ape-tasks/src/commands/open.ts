import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../config.ts'
import { info, printLine } from '../output.ts'

interface TaskRef { id: string, team_id: string }

/**
 * Open a task's list (team) in the web UI — the list page is the task board,
 * so there's no per-task URL. Useful for humans mid-terminal-flow. Headless
 * environments get the URL printed instead of a browser launch.
 *
 * EXAMPLE
 *   $ ape-tasks open 01HXX...
 *   https://tasks.openape.ai/teams/01HYY...
 *   (browser opens)
 */
export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Open a task\u2019s list in the default browser.' },
  args: {
    taskId: { type: 'positional', required: true, description: 'Task ULID.' },
    'print-only': { type: 'boolean', description: 'Print the URL without launching a browser.' },
    endpoint: { type: 'string', description: 'Override tasks endpoint.' },
  },
  async run({ args }) {
    const endpoint = resolveEndpoint(args.endpoint)
    const task = await apiCall<TaskRef>('GET', `/api/tasks/${args.taskId}`, { endpoint })
    const url = `${endpoint}/teams/${task.team_id}`
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
