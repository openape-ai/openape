export interface InboxLink { title: string, url: string }
export interface InboxPublication { eventId: string, kind: 'message', title: string, body: string, podId: string | null, podName: string | null, runId: string | null, links: InboxLink[] }
export interface InboxDecisionData { sourceId: string, digest: string, type: string, authority: 'pods' | 'idp' | 'secrets', options: { key: string, title: string, input: 'evidence' | 'value' | null }[], runtimeId: string }
export interface InboxItem { id: string, kind: 'message' | 'decision', state: string, decision: InboxDecisionData | null, title: string, body: string, pod: { id: string, name: string | null } | null, runId: string | null, links: InboxLink[], created: number, sequence: number, read: number | null, archived: number | null, deleted: number | null }
export interface InboxDevice { id: string, agent: string, created: number, seen: number, push?: boolean }
export interface InboxSubscription { endpoint: string, p256dh: string, auth: string }
export interface OutboxEntry { id: string, owner: string, itemId: string, attempts: number, created: number }
