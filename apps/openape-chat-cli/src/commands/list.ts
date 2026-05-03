import { defineCommand } from 'citty'
import { listMessages } from '../api'
import { getDefaultRoomId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show recent messages in a room' },
  args: {
    room: { type: 'string', description: 'Room id (defaults to `ape-chat rooms use <id>`)' },
    limit: { type: 'string', description: 'Max messages to fetch (1-200)', default: '50' },
    before: { type: 'string', description: 'Unix seconds — fetch only messages older than this' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const roomId = getDefaultRoomId(args.room)
    if (!roomId) {
      throw new Error('No room specified. Pass --room <id> or run `ape-chat rooms use <id>` first.')
    }
    const limit = Number.parseInt(args.limit, 10)
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw new Error('--limit must be an integer between 1 and 200')
    }
    const before = args.before ? Number.parseInt(args.before, 10) : undefined
    const messages = await listMessages(roomId, { limit, before })
    if (args.json) {
      printJson(messages)
      return
    }
    if (messages.length === 0) {
      printLine('(no messages)')
      return
    }
    for (const m of messages) {
      const actTag = m.senderAct === 'agent' ? '[agent]' : '       '
      const reply = m.replyTo ? ` ↩ ${m.replyTo.slice(0, 8)}` : ''
      printLine(`${fmtTime(m.createdAt)}  ${actTag} ${m.senderEmail}${reply}: ${m.body}`)
    }
  },
})
