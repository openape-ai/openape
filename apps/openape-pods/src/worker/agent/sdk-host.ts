import { readFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { Codex } from '@openai/codex-sdk'
import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk'

async function main(): Promise<void> {
  const channel = new Socket({ fd: 3, readable: false, writable: true })
  const emit = (value: unknown) => channel.write(`${JSON.stringify(value)}\n`)
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8')) as { options: CodexOptions, thread: ThreadOptions, prompt: string, timeMs: number }
    const thread = new Codex(config.options).startThread(config.thread)
    const { events } = await thread.runStreamed(config.prompt, { signal: AbortSignal.timeout(config.timeMs) })
    let response = ''; let finished = false
    for await (const event of events) {
      emit({ type: 'event', event })
      if (event.type === 'item.completed' && event.item.type === 'agent_message') response = event.item.text
      if (event.type === 'turn.completed') finished = true
      if (event.type === 'turn.failed' || event.type === 'error') throw new Error('Codex reported a failed turn')
    }
    if (!finished || !thread.id) throw new Error('Codex exited without a completed turn')
    emit({ type: 'complete', threadId: thread.id, response })
  }
  catch (error) { emit({ type: 'error', message: error instanceof Error ? error.message : 'SDK execution failed' }); process.exitCode = 1 }
  finally { channel.end(() => channel.destroy()) }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'SDK host failed'); process.exitCode = 1 })
