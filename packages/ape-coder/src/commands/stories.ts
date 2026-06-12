import { defineCommand } from 'citty'
import consola from 'consola'
import { CoderApi } from '../coder-api'
import { editStory, listStories } from '../handlers'

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List the user-stories of a project' },
  args: {
    project: { type: 'positional', required: true, description: 'Project id (see `ape-coder projects list`)' },
    json: { type: 'boolean', description: 'Output as JSON (machine-readable)' },
  },
  async run({ args }) {
    const stories = await listStories({ api: new CoderApi() }, String(args.project))
    if (args.json) {
      process.stdout.write(`${JSON.stringify(stories, null, 2)}\n`)
      return
    }
    if (stories.length === 0) {
      consola.info('No stories in this project yet.')
      return
    }
    const idW = Math.max(2, ...stories.map(s => s.id.length))
    const statusW = Math.max(6, ...stories.map(s => s.status.length))
    const header = `${'ID'.padEnd(idW)}  ${'STATUS'.padEnd(statusW)}  TITLE`
    console.log(header)
    console.log('-'.repeat(header.length))
    for (const s of stories) {
      console.log(`${s.id.padEnd(idW)}  ${s.status.padEnd(statusW)}  ${s.title}`)
    }
  },
})

const showCommand = defineCommand({
  meta: { name: 'show', description: 'Read a single user-story' },
  args: {
    project: { type: 'positional', required: true, description: 'Project id' },
    story: { type: 'positional', required: true, description: 'Story id' },
    json: { type: 'boolean', description: 'Output as JSON (machine-readable)' },
  },
  async run({ args }) {
    const story = await new CoderApi().getStory(String(args.project), String(args.story))
    if (args.json) {
      process.stdout.write(`${JSON.stringify(story, null, 2)}\n`)
      return
    }
    console.log(`# ${story.title}  [${story.status}]`)
    console.log(story.storySentence)
    if (story.acceptanceCriteria) {
      console.log('')
      console.log(story.acceptanceCriteria)
    }
  },
})

const setTitleCommand = defineCommand({
  meta: { name: 'set-title', description: 'Rename a story (needs the same write grant as in the app)' },
  args: {
    project: { type: 'positional', required: true, description: 'Project id' },
    story: { type: 'positional', required: true, description: 'Story id' },
    title: { type: 'positional', required: true, description: 'New title' },
    json: { type: 'boolean', description: 'Output as JSON' },
  },
  async run({ args }) {
    const updated = await editStory(
      { api: new CoderApi() },
      String(args.project),
      String(args.story),
      { title: String(args.title) },
    )
    if (args.json) {
      process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`)
      return
    }
    consola.success(`Renamed story ${updated.id} → "${updated.title}"`)
  },
})

export const storiesCommand = defineCommand({
  meta: { name: 'stories', description: 'Read and edit the user-stories of a project' },
  subCommands: {
    list: listCommand,
    show: showCommand,
    'set-title': setTitleCommand,
  },
})
