import { defineCommand } from 'citty'
import { sendMessage } from '../api'
import { getDefaultRoomId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

export const sendCommand = defineCommand({
  meta: { name: 'send', description: 'Post a message to a chat room' },
  args: {
    body: { type: 'positional', required: true, description: 'Message body (use quotes)' },
    room: { type: 'string', description: 'Room id (defaults to `ape-chat rooms use <id>`)' },
    'reply-to': { type: 'string', description: 'Message id to reply to' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const roomId = getDefaultRoomId(args.room)
    if (!roomId) {
      throw new Error('No room specified. Pass --room <id> or run `ape-chat rooms use <id>` first.')
    }
    const message = await sendMessage(roomId, {
      body: args.body,
      ...(args['reply-to'] ? { reply_to: args['reply-to'] } : {}),
    })
    if (args.json) {
      printJson(message)
      return
    }
    printLine(`sent ${message.id} at ${fmtTime(message.createdAt)}`)
  },
})
