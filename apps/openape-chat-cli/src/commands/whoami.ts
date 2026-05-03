import { defineCommand } from 'citty'
import { getChatCaller } from '../auth'
import { fmtTime, printJson, printLine } from '../output'

export const whoamiCommand = defineCommand({
  meta: { name: 'whoami', description: 'Show the identity the chat-CLI will act as' },
  args: {
    json: { type: 'boolean', description: 'Emit JSON', default: false },
  },
  async run({ args }) {
    const caller = await getChatCaller()
    if (args.json) {
      printJson(caller)
      return
    }
    printLine(`${caller.email}  (act=${caller.act}, expires=${fmtTime(caller.expires_at)})`)
  },
})
