import { defineCommand } from 'citty'
import type { ProofCliDescriptor } from '../descriptor'
import { printLine } from '../output'

/**
 * Print bundled documentation. The mechanism (list topics / print one) is
 * shared; the topic set and Markdown content are app-specific, so the app
 * passes its own `docs` map (its `cli.ts` imports the `.md` files via the
 * bundler and hands them in).
 */
export function makeDocsCommand(
  d: Pick<ProofCliDescriptor, 'name'>,
  docs: Record<string, string>,
) {
  const topics = Object.keys(docs).sort()
  return defineCommand({
    meta: {
      name: 'docs',
      description: `Print documentation. Topics: ${topics.join(', ')}.`,
    },
    args: {
      topic: { type: 'positional', required: false, description: 'Topic name. Omit to list topics.' },
    },
    async run({ args }) {
      if (!args.topic) {
        printLine('Available topics:')
        for (const key of topics) printLine(`  ${key}`)
        printLine('')
        printLine(`Example: \`ape-${d.name} docs ${topics[0] ?? 'agent'}\``)
        return
      }
      const doc = docs[args.topic.toLowerCase()]
      if (!doc) {
        printLine(`No such topic "${args.topic}". Available: ${topics.join(', ')}.`)
        process.exit(1)
      }
      process.stdout.write(doc.endsWith('\n') ? doc : `${doc}\n`)
    },
  })
}
