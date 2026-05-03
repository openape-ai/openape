import { defineCommand } from 'citty'
import { listRooms } from '../api'
import { setDefaultRoomId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

const listSub = defineCommand({
  meta: { name: 'list', description: 'List rooms the caller is a member of' },
  args: {
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const rooms = await listRooms()
    if (args.json) {
      printJson(rooms)
      return
    }
    if (rooms.length === 0) {
      printLine('(no rooms — invite yourself or accept an invite first)')
      return
    }
    for (const r of rooms) {
      const role = r.role ? `[${r.role}]` : ''
      printLine(`${r.id}  ${r.kind.padEnd(7)}  ${role.padEnd(8)}  ${r.name}  (created ${fmtTime(r.createdAt)})`)
    }
  },
})

const useSub = defineCommand({
  meta: { name: 'use', description: 'Set the default room id for subsequent commands' },
  args: {
    id: { type: 'positional', required: true, description: 'Room id (UUID)' },
  },
  run({ args }) {
    setDefaultRoomId(args.id)
    printLine(`default room set to ${args.id}`)
  },
})

const clearSub = defineCommand({
  meta: { name: 'clear', description: 'Clear the default room id' },
  run() {
    setDefaultRoomId(null)
    printLine('default room cleared')
  },
})

export const roomsCommand = defineCommand({
  meta: { name: 'rooms', description: 'List, create, and switch chat rooms' },
  subCommands: {
    list: listSub,
    use: useSub,
    clear: clearSub,
  },
})
