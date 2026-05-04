import { defineCommand } from 'citty'
import { getRoom, listRooms } from '../api'
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
      printLine('(no rooms — accept a contact request to start a DM)')
      return
    }
    for (const r of rooms) {
      printLine(`${r.id}  ${r.kind.padEnd(4)}  ${r.name}  (created ${fmtTime(r.createdAt)})`)
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

// Rooms are created lazily by the contact-accept flow (`ape-chat
// contacts accept`); there is no longer an explicit `rooms create`.
// The historical `kind:'channel'` path was removed in #276 — see
// the security audit on 2026-05-04 for the attack scenario.
export const roomsCommand = defineCommand({
  meta: { name: 'rooms', description: 'List and switch DM rooms (rooms are created via `ape-chat contacts accept`)' },
  subCommands: {
    list: listSub,
    info: infoSub,
    use: useSub,
    clear: clearSub,
  },
})
