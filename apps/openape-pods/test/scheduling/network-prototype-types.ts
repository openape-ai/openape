export interface PrototypeEvent {
  key: string
  channel: string
  payload: Record<string, unknown>
  sourceVersion: string
  inputEventIds?: string[]
}
export interface PrototypeInvocation {
  id: string
  networkId: string
  podId: string
  boot: string
  restore: string
  token: string
  epoch: number
  deliveries: string[]
  generations: Record<string, number>
}
export interface PrototypeWrite { key: string, expectedRevision: number, value: Record<string, unknown> }
export type PrototypeCommitPoint = 'beforeAccepted' | 'accepted' | 'effectConfirmed' | 'claimed' | 'beforeSettlement' | 'settled' | 'effectIssued'
