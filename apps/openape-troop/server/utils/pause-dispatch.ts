import { listNestPeersForOwner } from './nest-registry'

// Relay a pause/resume to a connected nest. Unlike spawn this is instant — the
// nest writes its registry in-process and its live dispatch/tick guards pick it
// up next turn — so there's no intent_id to poll: deliver the frame and return.
// `name` present → one agent; absent → the whole nest (kill-switch).

export interface PauseDispatchOptions {
  hostId?: string
  name?: string
  paused: boolean
}

export interface PauseDispatchResult {
  hostId: string
  hostname: string
}

export function dispatchPause(owner: string, opts: PauseDispatchOptions): PauseDispatchResult {
  const peers = listNestPeersForOwner(owner)
  if (peers.length === 0) {
    throw createError({ statusCode: 503, statusMessage: 'no connected nest — make sure the nest daemon is running.' })
  }
  const target = opts.hostId ? peers.find(p => p.hostId === opts.hostId) : peers[0]
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: `no nest found for host_id ${opts.hostId}` })
  }

  const ok = target.send({ type: 'set-pause', ...(opts.name ? { name: opts.name } : {}), paused: opts.paused })
  if (!ok) {
    throw createError({ statusCode: 503, statusMessage: 'nest dropped before the pause was delivered — retry in a few seconds' })
  }

  return { hostId: target.hostId, hostname: target.hostname }
}
