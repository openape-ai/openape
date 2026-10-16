import { RuntimeWorker } from '../main/runtime-worker'
import type { RuntimeHost } from '../main/runtime-host'
import { parseCliRequest } from '../contracts/cli'
import type { CliRequest } from '../contracts/cli'
import { assertDesktopClosed } from './profile'

export interface CliClient { request: (command: CliRequest) => Promise<unknown>, close: () => Promise<void> }

export async function startCliClient(root: string, base: string, host: RuntimeHost): Promise<CliClient> {
  await assertDesktopClosed(root)
  let ready: () => void = () => {}
  let fail: (error: Error) => void = () => {}
  const started = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject })
  const worker = new RuntimeWorker((status) => {
    if (status.state === 'ready') ready()
    else if (status.state === 'error' || status.state === 'recovery' || status.state === 'stopped') fail(new Error(status.error ?? 'Pods runtime stopped'))
  }, host)
  worker.start(root, base)
  try { await started }
  catch (error) { await worker.stop(); throw error }
  return {
    request: async (command) => {
      await assertDesktopClosed(root)
      return worker.cli(parseCliRequest(command))
    },
    close: () => worker.stop(),
  }
}
