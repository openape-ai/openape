import { defineCommand } from 'citty'
import { sendMessage } from '../api'
import { getDefaultRoomId, getDefaultThreadId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

export const sendCommand = defineCommand({
  meta: { name: 'send', description: 'Post a message to a chat room' },
  args: {
    body: { type: 'positional', required: true, description: 'Message body (use quotes)' },
    room: { type: 'string', description: 'Room id (defaults to `ape-chat rooms use <id>`)' },
    thread: { type: 'string', description: 'Thread id (defaults to active thread for the room → main)' },
    'reply-to': { type: 'string', description: 'Message id to reply to' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const roomId = getDefaultRoomId(args.room)
    if (!roomId) {
      throw new Error('No room specified. Pass --room <id> or run `ape-chat rooms use <id>` first.')
    }
    const threadId = getDefaultThreadId(roomId, args.thread)
    const message = await sendMessage(roomId, {
      body: args.body,
      ...(args['reply-to'] ? { reply_to: args['reply-to'] } : {}),
      ...(threadId ? { thread_id: threadId } : {}),
    })
    if (args.json) {
      printJson(message)
      return
    }
    printLine(`sent ${message.id} at ${fmtTime(message.createdAt)}`)
  },
})
