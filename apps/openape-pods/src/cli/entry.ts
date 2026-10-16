import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stripVTControlCharacters } from 'node:util'
import { cliArguments, cliHelp, UsageError } from './arguments'
import { cliProfile } from './profile'
import { nodeHost } from './node-host'
import { startCliClient } from './client'
import type { CliClient } from './client'
import { executeCli } from './commands'

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (!argv.length || argv.includes('--help')) { process.stdout.write(cliHelp); return 0 }
  const args = cliArguments(argv)
  const profile = cliProfile(args.profile)
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel)
  const terminal = process.stdin.isTTY && !args.json ? createInterface({ input: process.stdin, output: process.stderr }) : undefined
  let client: CliClient | undefined
  try {
    client = await startCliClient(profile.root, profile.base, nodeHost(join(__dirname, '..')))
    if (controller.signal.aborted) return 130
    return await executeCli(args, client, {
      signal: controller.signal,
      ask: terminal ? question => terminal.question(question, { signal: controller.signal }) : undefined,
      output: (value) => {
        if (args.json) { process.stdout.write(`${JSON.stringify(value)}\n`); return }
        const pods = (value as { pods?: { id: string, name: string, tags: string[], lifecycle: string, lastRun: { state: string } | null }[] }).pods
        if (pods) {
          process.stdout.write('ID\tNAME\tSTATE\tTAGS\tLAST RUN\n')
          for (const pod of pods) process.stdout.write(`${pod.id}\t${stripVTControlCharacters(pod.name).replace(/[\r\n\t]/g, ' ')}\t${pod.lifecycle}\t${pod.tags.map(tag => stripVTControlCharacters(tag)).join(', ')}\t${pod.lastRun?.state ?? '-'}\n`)
        }
        else {
          process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
        }
      },
      progress: (value) => { process.stderr.write(`${JSON.stringify(value)}\n`) },
    })
  }
  finally { terminal?.close(); await client?.close(); process.off('SIGINT', cancel); process.off('SIGTERM', cancel) }
}

async function entry(): Promise<void> {
  try { process.exitCode = await main() }
  catch (error) {
    const message = error instanceof Error ? error.message : 'CLI operation failed'
    const code = error instanceof Error && error.name === 'AbortError' ? 130 : error instanceof UsageError ? 2 : 3
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ error: message, code })}\n`)
    else process.stderr.write(`${stripVTControlCharacters(message)}\n`)
    process.exitCode = code
  }
}
void entry()
