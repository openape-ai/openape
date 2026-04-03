import { defineCommand } from 'citty'
import consola from 'consola'
import { guides } from '../guides'

export const workflowsCommand = defineCommand({
  meta: {
    name: 'workflows',
    description: 'Discover workflow guides',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Guide ID to show (omit for list)',
      required: false,
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
  },
  run({ args }) {
    if (args.id) {
      const guide = guides.find(g => g.id === String(args.id))
      if (!guide) {
        consola.error(`Guide not found: ${args.id}`)
        consola.info(`Available: ${guides.map(g => g.id).join(', ')}`)
        return process.exit(1)
      }

      if (args.json) {
        console.log(JSON.stringify(guide, null, 2))
        return
      }

      console.log(`\n  ${guide.title}`)
      console.log(`  ${guide.description}\n`)
      for (let i = 0; i < guide.steps.length; i++) {
        const step = guide.steps[i]!
        if (step.note) {
          console.log(`  Note: ${step.note}`)
        }
        else {
          console.log(`  ${i + 1}. ${step.description}`)
          if (step.command) {
            console.log(`     $ ${step.command}`)
          }
        }
      }
      console.log()
      return
    }

    // List mode
    if (args.json) {
      console.log(JSON.stringify(guides.map(g => ({ id: g.id, title: g.title, description: g.description })), null, 2))
      return
    }

    console.log('\n  Workflow Guides\n')
    for (const guide of guides) {
      console.log(`  ${guide.id.padEnd(24)} ${guide.title}`)
    }
    console.log(`\n  Show a guide: apes workflows <id>\n`)
  },
})
