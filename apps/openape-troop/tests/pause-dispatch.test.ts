import { afterEach, describe, expect, it } from 'vitest'
import { _nestRegistryInternal, registerNestPeer } from '../server/utils/nest-registry'
import { dispatchPause } from '../server/utils/pause-dispatch'

function fakePeer(opts: { owner: string, host: string, peerId: string, alive?: boolean }) {
  const sent: Array<Record<string, unknown>> = []
  return {
    sent,
    peer: {
      ownerEmail: opts.owner,
      hostId: opts.host,
      hostname: opts.host,
      version: 'test',
      lastSeenAt: 100,
      peerId: opts.peerId,
      send: (frame: Record<string, unknown>) => { sent.push(frame); return opts.alive !== false },
    },
  }
}

afterEach(() => {
  _nestRegistryInternal.peersByKey.clear()
})

describe('pause dispatch', () => {
  it('sends a per-agent set-pause frame to the owner\'s nest', () => {
    const a = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    registerNestPeer(a.peer)
    const r = dispatchPause('p@x', { name: 'zaz', paused: true })
    expect(r.hostId).toBe('mini')
    expect(a.sent[0]).toEqual({ type: 'set-pause', name: 'zaz', paused: true })
  })

  it('omits name for a nest-wide pause', () => {
    const a = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    registerNestPeer(a.peer)
    dispatchPause('p@x', { hostId: 'mini', paused: false })
    expect(a.sent[0]).toEqual({ type: 'set-pause', paused: false })
  })

  it('targets the named host when several are connected', () => {
    const mini = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    const laptop = fakePeer({ owner: 'p@x', host: 'laptop', peerId: 'p2' })
    registerNestPeer(mini.peer)
    registerNestPeer(laptop.peer)
    dispatchPause('p@x', { name: 'zaz', hostId: 'laptop', paused: true })
    expect(mini.sent).toEqual([])
    expect(laptop.sent[0]).toEqual({ type: 'set-pause', name: 'zaz', paused: true })
  })

  it('throws 503 when no nest is connected', () => {
    expect(() => dispatchPause('p@x', { name: 'zaz', paused: true })).toThrow()
  })

  it('throws when the targeted host_id is not connected', () => {
    registerNestPeer(fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' }).peer)
    expect(() => dispatchPause('p@x', { hostId: 'ghost', paused: true })).toThrow()
  })
})
