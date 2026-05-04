import { defineCommand } from 'citty'
import { listMembers } from '../api'
import { getDefaultRoomId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

function resolveRoom(roomArg: string | undefined): string {
  const id = getDefaultRoomId(roomArg)
  if (!id) {
    throw new Error('No room specified. Pass --room <id> or run `ape-chat rooms use <id>` first.')
  }
  return id
}

const listSub = defineCommand({
  meta: { name: 'list', description: 'List members of a room' },
  args: {
    room: { type: 'string', description: 'Room id (defaults to current `rooms use`)' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const members = await listMembers(resolveRoom(args.room))
    if (args.json) {
      printJson(members)
      return
    }
    if (members.length === 0) {
      printLine('(no members)')
      return
    }
    for (const m of members) {
      printLine(`${m.role.padEnd(7)}  ${m.userEmail}  (joined ${fmtTime(m.joinedAt)})`)
    }
  },
})

// Membership is fixed at room (= contact) creation. To start a chat
// with someone, use `ape-chat contacts add <email>`; to leave one,
// remove the contact. The historical `add` / `remove` mutations are
// gone — their endpoints let any admin enrol arbitrary emails as
// admins without consent (security audit 2026-05-04, #276).
export const membersCommand = defineCommand({
  meta: { name: 'members', description: 'List the two members of a DM room' },
  subCommands: {
    list: listSub,
  },
})
