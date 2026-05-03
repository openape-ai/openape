import { defineCommand } from 'citty'
import agentDoc from '../docs/agent.md'
import cliDoc from '../docs/cli.md'
import { printLine } from '../output'

const DOCS: Record<string, string> = {
  agent: agentDoc,
  cli: cliDoc,
}

export const docsCommand = defineCommand({
  meta: { name: 'docs', description: 'Print embedded documentation. Topics: agent, cli' },
  args: {
    topic: { type: 'positional', required: false, description: 'Topic name (default: cli)' },
  },
  run({ args }) {
    const key = args.topic ?? 'cli'
    const doc = DOCS[key]
    if (!doc) {
      printLine(`unknown topic "${key}". Available: ${Object.keys(DOCS).join(', ')}`)
      process.exit(1)
    }
    process.stdout.write(doc.endsWith('\n') ? doc : `${doc}\n`)
  },
})
