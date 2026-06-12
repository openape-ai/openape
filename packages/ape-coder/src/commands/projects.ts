import { defineCommand } from 'citty'
import consola from 'consola'
import { CoderApi } from '../coder-api'
import { listProjects } from '../handlers'

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List the projects you can see — exactly the ones the app shows you' },
  args: {
    json: { type: 'boolean', description: 'Output as JSON (machine-readable)' },
  },
  async run({ args }) {
    const projects = await listProjects({ api: new CoderApi() })
    if (args.json) {
      process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`)
      return
    }
    if (projects.length === 0) {
      consola.info('No projects. You are not a member of any project yet.')
      return
    }
    const idW = Math.max(2, ...projects.map(p => p.id.length))
    const header = `${'ID'.padEnd(idW)}  NAME`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const p of projects) {
      console.log(`${p.id.padEnd(idW)}  ${p.name}`)
    }
  },
})

export const projectsCommand = defineCommand({
  meta: { name: 'projects', description: 'Browse the projects you are a member of' },
  subCommands: {
    list: listCommand,
  },
})
