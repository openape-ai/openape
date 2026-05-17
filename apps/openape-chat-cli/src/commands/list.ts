import { defineCommand } from 'citty'
import { listMessages } from '../api'
import { getDefaultRoomId, getDefaultThreadId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'Show recent messages in a room' },
  args: {
    room: { type: 'string', description: 'Room id (defaults to `ape-chat rooms use <id>`)' },
    thread: { type: 'string', description: 'Thread id (defaults to active thread for the room; pass "all" for every thread)' },
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
    // `--thread all` is the explicit escape hatch for "show me every
    // thread"; without it, fall back to the room's active thread (if
    // set) so per-thread context is the default reading mode.
    const threadId = args.thread === 'all'
      ? undefined
      : getDefaultThreadId(roomId, args.thread)
    const messages = await listMessages(roomId, { limit, before, threadId })
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
