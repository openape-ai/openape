import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  _nestRegistryInternal,
  broadcastToOwner,
  getNestPeer,
  listNestPeersForOwner,
  registerNestPeer,
  touchNestPeer,
  unregisterNestPeerById,
} from '../server/utils/nest-registry'

function fakePeer(opts: { owner: string, host: string, peerId: string }) {
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
      send: (frame: Record<string, unknown>) => { sent.push(frame); return true },
    },
  }
}

afterEach(() => {
  _nestRegistryInternal.peersByKey.clear()
})

describe('nest registry', () => {
  it('register + get by (owner, host)', () => {
    const a = fakePeer({ owner: 'p@x', host: 'mac-mini', peerId: 'p1' })
    registerNestPeer(a.peer)
    expect(getNestPeer('p@x', 'mac-mini')).toBe(a.peer)
    expect(getNestPeer('p@x', 'laptop')).toBeUndefined()
  })

  it('owner-email lookup is case-insensitive', () => {
    const a = fakePeer({ owner: 'Patrick@Example.Com', host: 'mac', peerId: 'p1' })
    registerNestPeer(a.peer)
    expect(getNestPeer('patrick@example.com', 'mac')).toBe(a.peer)
    expect(getNestPeer('PATRICK@example.com', 'mac')).toBe(a.peer)
  })

  it('listNestPeersForOwner returns multi-host', () => {
    registerNestPeer(fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' }).peer)
    registerNestPeer(fakePeer({ owner: 'p@x', host: 'laptop', peerId: 'p2' }).peer)
    registerNestPeer(fakePeer({ owner: 'other@x', host: 'mini', peerId: 'p3' }).peer)
    const mine = listNestPeersForOwner('p@x')
    expect(mine.map(p => p.hostId).toSorted()).toEqual(['laptop', 'mini'])
  })

  it('unregisterNestPeerById drops the right row even if multiple share an owner', () => {
    registerNestPeer(fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' }).peer)
    registerNestPeer(fakePeer({ owner: 'p@x', host: 'laptop', peerId: 'p2' }).peer)
    unregisterNestPeerById('p1')
    expect(getNestPeer('p@x', 'mini')).toBeUndefined()
    expect(getNestPeer('p@x', 'laptop')).toBeDefined()
  })

  it('touchNestPeer bumps lastSeenAt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const a = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    a.peer.lastSeenAt = 1
    registerNestPeer(a.peer)
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
    touchNestPeer('p1')
    expect(getNestPeer('p@x', 'mini')?.lastSeenAt).toBe(Math.floor(new Date('2026-01-01T00:01:00Z').getTime() / 1000))
    vi.useRealTimers()
  })

  it('broadcastToOwner fans out only to that owner', () => {
    const a = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    const b = fakePeer({ owner: 'p@x', host: 'laptop', peerId: 'p2' })
    const c = fakePeer({ owner: 'other@x', host: 'mini', peerId: 'p3' })
    registerNestPeer(a.peer)
    registerNestPeer(b.peer)
    registerNestPeer(c.peer)
    const sent = broadcastToOwner('p@x', { type: 'config-update', agent_email: 'foo' })
    expect(sent).toBe(2)
    expect(a.sent[0]).toEqual({ type: 'config-update', agent_email: 'foo' })
    expect(b.sent[0]).toEqual({ type: 'config-update', agent_email: 'foo' })
    expect(c.sent).toEqual([])
  })

  it('broadcastToOwner counts only successful sends', () => {
    const a = fakePeer({ owner: 'p@x', host: 'mini', peerId: 'p1' })
    const b = fakePeer({ owner: 'p@x', host: 'laptop', peerId: 'p2' })
    // Simulate a dead socket
    b.peer.send = () => false
    registerNestPeer(a.peer)
    registerNestPeer(b.peer)
    expect(broadcastToOwner('p@x', { type: 'x' })).toBe(1)
  })
})
