import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { printJson, printLine } from '../output.ts'

interface Note { id: string, body: string, author_email: string, created_at: number }

const add = defineCommand({
  meta: { name: 'add', description: 'Append a note to a deal.' },
  args: {
    id: { type: 'positional', required: true, description: 'Deal ULID.' },
    text: { type: 'positional', required: true, description: 'Note text.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const note = await apiCall<Note>('POST', `/api/deals/${args.id}/notes`, {
      endpoint: args.endpoint,
      body: { body: args.text },
    })
    if (args.json) { printJson(note); return }
    printLine(`${note.id}  ${note.body}`)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'Show the notes of a deal, newest first.' },
  args: {
    id: { type: 'positional', required: true, description: 'Deal ULID.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const rows = await apiCall<Note[]>('GET', `/api/deals/${args.id}/notes`, { endpoint: args.endpoint })
    if (args.json) { printJson(rows); return }
    for (const n of rows) printLine(`${new Date(n.created_at).toISOString()}  ${n.author_email}  ${n.body}`)
  },
})

export const noteCommand = defineCommand({
  meta: { name: 'note', description: 'Notes on a deal.' },
  subCommands: { add, list },
})
