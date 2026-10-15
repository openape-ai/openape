import type { CentralCommand, CentralRuntime } from '../contracts/central'
import type { DomainCommand, DomainOverview } from '../contracts/domain-admin'
import type { PodsBridge } from '../contracts/ipc'
import type { MapView } from '../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../contracts/secrets'
import type { InboxMessage, InboxMessagePage, InboxMessagesCommand } from '../contracts/inbox'

export interface WorkspaceSnapshot {
  map: MapView | null
  domain: DomainOverview | null
  codex: 'connected' | 'disconnected' | undefined
  secrets: SecretsView | null
  /** Absent or null when the host cannot read the account inbox. */
  messages?: MessagesView | null
  live: boolean
}

/** The loaded pages of inbox and archive; `error` keeps the last list visible when an update fails. */
export interface MessagesView { messages: InboxMessage[], more: { inbox: boolean, archive: boolean }, error: string | null }
/** `more` is local: it loads the next page of one view on the following read. */
export type MessagesAccessCommand = InboxMessagesCommand | { type: 'more', archived: boolean }
type ListMessages = (command: Extract<InboxMessagesCommand, { type: 'list' }>) => Promise<InboxMessagePage | null>

/**
 * One reader for every host: it lists inbox and archive, follows `next` for the pages the owner asked for and
 * reads again only when due (about every ten workspace reads, or after a change), not on the one-second poll.
 */
export function messagesReader(list: ListMessages) {
  const pages = { inbox: 1, archive: 1 }
  let view: MessagesView | null | undefined
  let due = true
  async function read(archived: boolean): Promise<InboxMessagePage | null> {
    const messages: InboxMessage[] = []
    let next: number | null = null
    for (let page = 0; page < pages[archived ? 'archive' : 'inbox']; page++) {
      const result = await list({ type: 'list', archived, ...(next === null ? {} : { before: next }) })
      if (!result) return null
      messages.push(...result.messages); next = result.next
      if (next === null) break
    }
    return { messages, next }
  }
  return {
    async view(tick: boolean): Promise<MessagesView | null> {
      if (!tick && !due && view !== undefined) return view
      due = false
      try {
        const [inbox, archive] = await Promise.all([read(false), read(true)])
        view = inbox && archive ? { messages: [...inbox.messages, ...archive.messages], more: { inbox: inbox.next !== null, archive: archive.next !== null }, error: null } : null
      }
      catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        view = { messages: view?.messages ?? [], more: view?.more ?? { inbox: false, archive: false }, error }
      }
      return view
    },
    /** Applies a change through the host first, so a read that raced with it cannot keep the old state. */
    async command(command: MessagesAccessCommand, apply: (command: InboxMessagesCommand) => Promise<unknown>): Promise<void> {
      if (command.type === 'more') pages[command.archived ? 'archive' : 'inbox']++
      else await apply(command)
      due = true
    },
  }
}

export interface WorkspaceAccess {
  desktop: boolean
  inboxUrl?: string
  read: () => Promise<WorkspaceSnapshot>
  command: (command: CentralCommand) => Promise<unknown>
  domain?: (command: DomainCommand) => Promise<unknown>
  secrets?: (command: SecretsCommand) => Promise<unknown>
  messages?: (command: MessagesAccessCommand) => Promise<unknown>
}

export function localWorkspaceAccess(bridge: PodsBridge): WorkspaceAccess {
  let reads = 0
  let codex: WorkspaceSnapshot['codex']
  let secrets: SecretsView | null = null
  const inbox = bridge.messages ? messagesReader(command => bridge.messages!(command)) : null
  return {
    desktop: true,
    async read() {
      const tick = reads++ % 10 === 0
      const [inventory, domain, messages] = await Promise.all([bridge.workspace({ type: 'map' }), bridge.domain({ type: 'list' }), inbox?.view(tick) ?? null])
      if (tick) {
        const [connection, requests] = await Promise.all([bridge.codex({ type: 'status' }), bridge.secrets?.({ type: 'list' })])
        codex = connection.state === 'connected' ? 'connected' : 'disconnected'
        secrets = requests ?? null
      }
      return { map: inventory.map ?? null, domain: domain as DomainOverview, codex, secrets, messages, live: true }
    },
    async command(command) {
      if (command.channel === 'workspace') return bridge.workspace(command.body as Parameters<PodsBridge['workspace']>[0])
      if (command.channel === 'scheduling') return bridge.scheduling(command.body as Parameters<PodsBridge['scheduling']>[0])
      if (command.channel === 'runs') return bridge.runs(command.body as Parameters<PodsBridge['runs']>[0])
      throw new Error(`Unsupported workspace channel: ${command.channel}`)
    },
    domain: command => bridge.domain(command),
    ...(inbox ? { messages: (command: MessagesAccessCommand) => inbox.command(command, change => bridge.messages!(change)) } : {}),
    ...(bridge.secrets ? { secrets: async (command: SecretsCommand) => { secrets = await bridge.secrets!(command); return secrets } } : {}),
  }
}

/** `messages` reads the account inbox through the owner's session; it works while the desktop is offline. */
export function browserWorkspaceAccess(runtime: () => CentralRuntime | undefined, command: (command: CentralCommand) => Promise<unknown>, messages?: (command: InboxMessagesCommand) => Promise<InboxMessagePage | null>): WorkspaceAccess {
  const inbox = messages ? messagesReader(messages) : null
  let reads = 0
  return {
    desktop: false,
    inboxUrl: '/inbox/',
    async read() { return { map: runtime()?.workspace.map ?? null, domain: null, codex: undefined, secrets: null, messages: await inbox?.view(reads++ % 10 === 0) ?? null, live: !!runtime()?.online } },
    ...(inbox ? { messages: (command: MessagesAccessCommand) => inbox.command(command, change => messages!(change)) } : {}),
    async command(request) {
      if (!runtime()?.online) throw new Error('Desktop offline')
      return command(request)
    },
  }
}
