import { defineCommand } from 'citty'
import { addMember, listMembers, removeMember } from '../api'
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

const addSub = defineCommand({
  meta: { name: 'add', description: 'Invite a user (or agent) to a room (admins only)' },
  args: {
    email: { type: 'positional', required: true, description: 'Email of the member to add' },
    room: { type: 'string', description: 'Room id (defaults to current `rooms use`)' },
    role: { type: 'string', default: 'member', description: 'member | admin' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    if (args.role !== 'member' && args.role !== 'admin') {
      throw new Error('--role must be "member" or "admin"')
    }
    const member = await addMember(resolveRoom(args.room), { email: args.email, role: args.role })
    if (args.json) {
      printJson(member)
      return
    }
    printLine(`added ${member.userEmail} as ${member.role}`)
  },
})

const removeSub = defineCommand({
  meta: { name: 'remove', description: 'Remove a user from a room (admins only)' },
  args: {
    email: { type: 'positional', required: true, description: 'Email of the member to remove' },
    room: { type: 'string', description: 'Room id (defaults to current `rooms use`)' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const result = await removeMember(resolveRoom(args.room), args.email)
    if (args.json) {
      printJson(result)
      return
    }
    printLine(`removed ${args.email}`)
  },
})

export const membersCommand = defineCommand({
  meta: { name: 'members', description: 'List, add, or remove room members' },
  subCommands: {
    list: listSub,
    add: addSub,
    remove: removeSub,
  },
})
