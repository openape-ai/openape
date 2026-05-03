import { defineCommand } from 'citty'
import { archiveThread, createThread, listThreads, patchThread } from '../api'
import { getDefaultRoomId, getDefaultThreadId, setDefaultThreadId } from '../config'
import { fmtTime, printJson, printLine } from '../output'

function requireRoom(arg?: string | null): string {
  const roomId = getDefaultRoomId(arg)
  if (!roomId) {
    throw new Error('No room specified. Pass --room <id> or run `ape-chat rooms use <id>` first.')
  }
  return roomId
}

const listSub = defineCommand({
  meta: { name: 'list', description: 'List threads in a room' },
  args: {
    room: { type: 'string', description: 'Room id (defaults to active room)' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const roomId = requireRoom(args.room)
    const threads = await listThreads(roomId)
    if (args.json) {
      printJson(threads)
      return
    }
    if (threads.length === 0) {
      printLine('(no threads)')
      return
    }
    const active = getDefaultThreadId(roomId)
    for (const t of threads) {
      const marker = active === t.id ? '* ' : '  '
      const archived = t.archivedAt ? ' [archived]' : ''
      printLine(`${marker}${t.id.slice(0, 8)}  ${t.name}${archived}  (created ${fmtTime(t.createdAt)})`)
    }
  },
})

const newSub = defineCommand({
  meta: { name: 'new', description: 'Create a new thread in a room' },
  args: {
    name: { type: 'positional', required: true, description: 'Thread name' },
    room: { type: 'string', description: 'Room id (defaults to active room)' },
    use: { type: 'boolean', default: true, description: 'Make this the active thread for the room' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const roomId = requireRoom(args.room)
    const thread = await createThread(roomId, { name: args.name })
    if (args.use) setDefaultThreadId(roomId, thread.id)
    if (args.json) {
      printJson(thread)
      return
    }
    printLine(`created ${thread.id} (${thread.name})${args.use ? ' — now active' : ''}`)
  },
})

const useSub = defineCommand({
  meta: { name: 'use', description: 'Set the active thread for a room' },
  args: {
    thread: { type: 'positional', required: false, description: 'Thread id (omit + --clear to unset)' },
    room: { type: 'string', description: 'Room id (defaults to active room)' },
    clear: { type: 'boolean', default: false, description: 'Unset the active thread for the room' },
  },
  async run({ args }) {
    const roomId = requireRoom(args.room)
    if (args.clear || !args.thread) {
      setDefaultThreadId(roomId, null)
      printLine(`active thread cleared for room ${roomId}`)
      return
    }
    setDefaultThreadId(roomId, args.thread)
    printLine(`active thread for room ${roomId} → ${args.thread}`)
  },
})

const renameSub = defineCommand({
  meta: { name: 'rename', description: 'Rename a thread' },
  args: {
    thread: { type: 'positional', required: true, description: 'Thread id' },
    name: { type: 'positional', required: true, description: 'New name' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const updated = await patchThread(args.thread, { name: args.name })
    if (args.json) {
      printJson(updated)
      return
    }
    printLine(`renamed ${updated.id} → ${updated.name}`)
  },
})

const archiveSub = defineCommand({
  meta: { name: 'archive', description: 'Archive a thread (soft-delete; history preserved)' },
  args: {
    thread: { type: 'positional', required: true, description: 'Thread id' },
  },
  async run({ args }) {
    await archiveThread(args.thread)
    printLine(`archived ${args.thread}`)
  },
})

export const threadsCommand = defineCommand({
  meta: { name: 'threads', description: 'List, create, switch and archive threads inside a room' },
  subCommands: {
    list: listSub,
    new: newSub,
    use: useSub,
    rename: renameSub,
    archive: archiveSub,
  },
})
