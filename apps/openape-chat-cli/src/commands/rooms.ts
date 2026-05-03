import { defineCommand } from 'citty'
import { createRoom, getRoom, listRooms } from '../api'
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

const createSub = defineCommand({
  meta: { name: 'create', description: 'Create a new room' },
  args: {
    name: { type: 'string', required: true, description: 'Display name' },
    kind: { type: 'string', default: 'channel', description: 'channel | dm' },
    members: { type: 'string', description: 'Comma-separated member emails to invite' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    if (args.kind !== 'channel' && args.kind !== 'dm') {
      throw new Error('--kind must be "channel" or "dm"')
    }
    const memberList = args.members
      ? args.members.split(',').map(s => s.trim()).filter(Boolean)
      : []
    const room = await createRoom({ name: args.name, kind: args.kind, members: memberList })
    if (args.json) {
      printJson(room)
      return
    }
    printLine(`created ${room.id}  ${room.kind}  ${room.name}`)
  },
})

const infoSub = defineCommand({
  meta: { name: 'info', description: 'Show metadata for one room' },
  args: {
    id: { type: 'positional', required: true, description: 'Room id' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const room = await getRoom(args.id)
    if (args.json) {
      printJson(room)
      return
    }
    printLine(`id:        ${room.id}`)
    printLine(`name:      ${room.name}`)
    printLine(`kind:      ${room.kind}`)
    printLine(`createdBy: ${room.createdByEmail}`)
    printLine(`createdAt: ${fmtTime(room.createdAt)}`)
  },
})

export const roomsCommand = defineCommand({
  meta: { name: 'rooms', description: 'List, create, and switch chat rooms' },
  subCommands: {
    list: listSub,
    create: createSub,
    info: infoSub,
    use: useSub,
    clear: clearSub,
  },
})
