import { defineCommand } from 'citty'
import { ApiError, _request as request } from '../api'
import { fmtTime, printJson, printLine } from '../output'

interface ContactView {
  peerEmail: string
  myStatus: 'accepted' | 'pending' | 'blocked'
  theirStatus: 'accepted' | 'pending' | 'blocked'
  connected: boolean
  roomId: string | null
  requestedAt: number
  acceptedAt: number | null
}

function listContactsApi(): Promise<ContactView[]> {
  return request<ContactView[]>('/api/contacts')
}
function addContactApi(email: string): Promise<ContactView> {
  return request<ContactView>('/api/contacts', { method: 'POST', body: { email } })
}
function acceptContactApi(email: string): Promise<ContactView> {
  return request<ContactView>(`/api/contacts/${encodeURIComponent(email)}/accept`, { method: 'POST' })
}
function removeContactApi(email: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/contacts/${encodeURIComponent(email)}`, { method: 'DELETE' })
}

const listSub = defineCommand({
  meta: { name: 'list', description: 'List contacts (connected, pending in/out)' },
  args: {
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const all = await listContactsApi()
    if (args.json) {
      printJson(all)
      return
    }
    if (all.length === 0) {
      printLine('(no contacts — `ape-chat contacts add <email>` to send a request)')
      return
    }
    for (const c of all) {
      const tag = c.connected
        ? 'connected '
        : c.myStatus === 'pending'
          ? 'incoming  '
          : c.theirStatus === 'pending'
            ? 'outgoing  '
            : c.myStatus
      const ts = c.acceptedAt ?? c.requestedAt
      printLine(`${tag}  ${c.peerEmail.padEnd(44)}  ${fmtTime(ts)}`)
    }
  },
})

const addSub = defineCommand({
  meta: { name: 'add', description: 'Send a contact request' },
  args: {
    email: { type: 'positional', required: true, description: 'Email of the peer' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const view = await addContactApi(args.email)
    if (args.json) {
      printJson(view)
      return
    }
    if (view.connected) {
      printLine(`✔ already connected to ${view.peerEmail}`)
    }
    else {
      printLine(`✔ request sent to ${view.peerEmail} (waiting for accept)`)
    }
  },
})

const acceptSub = defineCommand({
  meta: { name: 'accept', description: 'Accept a pending incoming request' },
  args: {
    email: { type: 'positional', required: true },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    try {
      const view = await acceptContactApi(args.email)
      if (args.json) {
        printJson(view)
        return
      }
      printLine(view.connected
        ? `✔ accepted — connected to ${view.peerEmail}`
        : `✔ marked accepted on your side; waiting for ${view.peerEmail}`)
    }
    catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new ApiError(404, `no pending request from ${args.email}`)
      }
      throw err
    }
  },
})

const removeSub = defineCommand({
  meta: { name: 'remove', description: 'Unfriend (or cancel an outgoing request)' },
  args: {
    email: { type: 'positional', required: true },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    await removeContactApi(args.email)
    if (args.json) {
      printJson({ removed: args.email })
      return
    }
    printLine(`✔ removed ${args.email}`)
  },
})

export const contactsCommand = defineCommand({
  meta: { name: 'contacts', description: 'List, add, accept, or remove 1:1 contacts' },
  subCommands: {
    list: listSub,
    add: addSub,
    accept: acceptSub,
    remove: removeSub,
  },
})
