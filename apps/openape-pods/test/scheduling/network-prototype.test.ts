// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { boundedStep } from '../../src/worker/scheduling/tick-step'
import { NetworkPrototype } from './network-prototype'
import type { PrototypeCommitPoint, PrototypeEvent, PrototypeInvocation } from './network-prototype-types'

const roots: string[] = []; const stores: NetworkPrototype[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-network-proof-')); roots.push(root)
  const proof = new NetworkPrototype(root); stores.push(proof)
  proof.network('network')
  const source = proof.member('network'); const a = proof.member('network', ['input']); const b = proof.member('network', ['input'])
  return { root, proof, source, a, b }
}
function event(key = 'item', channel = 'input'): PrototypeEvent { return { key, channel, sourceVersion: 'v1', payload: { key } } }
function seed(f: ReturnType<typeof fixture>, items = [event()]) { return f.proof.acceptSource(f.proof.source('network', f.source), 'binding', items, 0, { cursor: 'page-2' }) }
function required(claim: PrototypeInvocation | null): PrototypeInvocation {
  expect(claim).not.toBeNull()
  if (!claim) throw new Error('Expected a ready invocation')
  return claim
}
function count(proof: NetworkPrototype, table: string): number { return Number(proof.store.db.prepare(`SELECT count(*) AS count FROM prototype_${table}`).get()?.count) }
function expectProjection(proof: NetworkPrototype) {
  expect(proof.projection()).toEqual(proof.store.db.prepare('SELECT s.network_id,d.state,count(*) AS count FROM prototype_deliveries d JOIN prototype_subscriptions s ON s.id=d.subscription_id GROUP BY s.network_id,d.state ORDER BY s.network_id,d.state').all())
}
function reopen(f: ReturnType<typeof fixture>) {
  f.proof.close(); stores.splice(stores.indexOf(f.proof), 1)
  f.proof = new NetworkPrototype(f.root); stores.push(f.proof)
  return f.proof
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('isolated persistent-network transaction prototype', () => {
  it('durably accepts once, independently fans out and launches no empty consumer', () => {
    const f = fixture(); const [id] = seed(f)
    const a = required(f.proof.claim('network', f.a)); f.proof.settle(a)
    expect(f.proof.claim('network', f.a)).toBeNull()
    expect(f.proof.items(required(f.proof.claim('network', f.b)))).toEqual([expect.objectContaining({ eventId: id, key: 'item' })])
    const source = f.proof.source('network', f.source)
    expect(f.proof.acceptSource(source, 'binding', [event()], 1, { cursor: 'page-2' })).toEqual([id])
    expect(count(f.proof, 'events')).toBe(1); expect(count(f.proof, 'deliveries')).toBe(2)
  })

  it('refuses conflicting source content without accepting an item or advancing its cursor', () => {
    const f = fixture(); seed(f)
    const source = f.proof.source('network', f.source)
    expect(() => f.proof.acceptSource(source, 'binding', [{ ...event(), payload: { changed: true } }], 1, { cursor: 'bad' })).toThrow('conflicting')
    expect(f.proof.store.db.prepare('SELECT revision FROM prototype_checkpoints WHERE pod_id=?').get(f.source)?.revision).toBe(1)
    expect(count(f.proof, 'events')).toBe(1)
  })

  it('rolls back writes, emits, checkpoint and acknowledgement together on a stale record', () => {
    const f = fixture(); seed(f)
    const a = required(f.proof.claim('network', f.a)); const b = required(f.proof.claim('network', f.b))
    f.proof.settle(a, [], [{ key: 'record', expectedRevision: 0, value: { status: 'first' } }])
    expect(() => f.proof.settle(b, [event('output', 'result')], [
      { key: 'new', expectedRevision: 0, value: { staged: true } },
      { key: 'record', expectedRevision: 0, value: { status: 'stale' } },
    ])).toThrow('revision conflict')
    expect(f.proof.store.db.prepare('SELECT item_key FROM prototype_records').all()).toEqual([{ item_key: 'record' }])
    expect(count(f.proof, 'events')).toBe(1)
    expect(f.proof.store.db.prepare('SELECT revision FROM prototype_checkpoints WHERE pod_id=?').get(f.b)?.revision).toBe(0)
    expect(f.proof.store.db.prepare('SELECT state FROM prototype_deliveries WHERE invocation_id=?').get(b.id)?.state).toBe('claimed')
  })

  it('fences a stopped consumer without invalidating a healthy branch or allowing effect begin', () => {
    const f = fixture(); seed(f)
    const a = required(f.proof.claim('network', f.a)); const b = required(f.proof.claim('network', f.b))
    expect(() => f.proof.stop(a, false)).toThrow('termination')
    f.proof.stop(a, true)
    const retry = required(f.proof.claim('network', f.a))
    expect(() => f.proof.settle(a, [event('stale')])).toThrow('Obsolete')
    expect(() => f.proof.beginEffect(a, 'item', 'synthetic-write')).toThrow('Obsolete')
    f.proof.settle(b); f.proof.settle(retry)
    expect(count(f.proof, 'leases')).toBe(0)
    expect(f.proof.projection()).toEqual([{ network_id: 'network', state: 'done', count: 2 }])
  })

  it('fences timer-source callbacks separately and retains source work after a timeout', async () => {
    const f = fixture(); seed(f)
    const healthy = required(f.proof.claim('network', f.b))
    const source = f.proof.source('network', f.source)
    let lateError: unknown
    const late = async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      try { f.proof.acceptSource(source, 'binding', [event('late')], 1, {}) }
      catch (error) { lateError = error }
    }
    let pending: Promise<void> | undefined
    await boundedStep(1, () => { pending = late(); return pending }, () => f.proof.cancel(source))
    expect(() => f.proof.source('network', f.source)).toThrow('still reserved')
    f.proof.recoverStoppedProcesses()
    f.proof.assertCurrent(healthy)
    await pending
    f.proof.stop(source, true)
    f.proof.settle(healthy)
    expect(lateError).toBeInstanceOf(Error); expect(String(lateError)).toContain('Obsolete')
    expect(count(f.proof, 'events')).toBe(1)
    f.proof.acceptSource(f.proof.source('network', f.source), 'binding', [event('next')], 1, {})
    expect(count(f.proof, 'events')).toBe(2)
  })

  it('keeps confirmed effect evidence across restart without issuing it twice', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    expect(f.proof.beginEffect(claim, 'item', 'synthetic-write')).toBe(true)
    f.proof.completeEffect(claim, 'item', 'synthetic-write')
    reopen(f); f.proof.recoverStoppedProcesses()
    const retry = required(f.proof.claim('network', f.a))
    expect(f.proof.beginEffect(retry, 'item', 'synthetic-write')).toBe(false)
    f.proof.settle(retry)
    expect(count(f.proof, 'effect_receipts')).toBe(2)
  })

  it('refuses settlement with an open intent and fences delivery generations', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(claim, 'item', 'synthetic-write')
    expect(() => f.proof.settle(claim)).toThrow('Unresolved external effect')
    expect(f.proof.store.db.prepare('SELECT state FROM prototype_deliveries WHERE invocation_id=?').get(claim.id)?.state).toBe('claimed')
    f.proof.store.db.prepare('UPDATE prototype_deliveries SET generation=generation+1 WHERE invocation_id=?').run(claim.id)
    expect(() => f.proof.settle(claim)).toThrow('Obsolete delivery')
  })

  it('requires reviewed negative reconciliation before a new numbered effect attempt', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(claim, 'item', 'synthetic-write'); f.proof.stop(claim, true)
    const effect = f.proof.store.db.prepare('SELECT logical_key FROM prototype_effect_attempts').get()
    expect(() => f.proof.confirmNotApplied(String(effect?.logical_key), 1, claim.restore, false)).toThrow('Explicit reconciliation')
    expect(() => f.proof.confirmNotApplied(String(effect?.logical_key), 1, 'stale', true)).toThrow('incarnation')
    f.proof.confirmNotApplied(String(effect?.logical_key), 1, claim.restore, true)
    expect(() => f.proof.confirmNotApplied(String(effect?.logical_key), 1, claim.restore, true)).toThrow('Stale reconciliation')
    const retry = required(f.proof.claim('network', f.a))
    expect(f.proof.beginEffect(retry, 'item', 'synthetic-write')).toBe(true)
    f.proof.completeEffect(retry, 'item', 'synthetic-write'); f.proof.settle(retry)
    expect(f.proof.store.db.prepare('SELECT attempt,state FROM prototype_effect_attempts ORDER BY attempt').all()).toEqual([{ attempt: 1, state: 'not_applied' }, { attempt: 2, state: 'completed' }])
    expect(count(f.proof, 'effect_receipts')).toBe(5)
  })

  it('keeps unknown delivery blocked until every effect has a reviewed resolution', () => {
    const f = fixture(); seed(f, [event('first'), event('second')])
    const claim = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(claim, 'first', 'synthetic-write'); f.proof.beginEffect(claim, 'second', 'synthetic-write')
    f.proof.stop(claim, true)
    const effects = f.proof.store.db.prepare('SELECT logical_key FROM prototype_effect_attempts WHERE invocation_id=? ORDER BY logical_key').all(claim.id)
    expect(effects).toHaveLength(2)
    f.proof.confirmNotApplied(String(effects[0]?.logical_key), 1, claim.restore, true)
    expect(f.proof.claim('network', f.a)).toBeNull()
    expect(f.proof.store.db.prepare('SELECT DISTINCT state FROM prototype_deliveries WHERE invocation_id=?').all(claim.id)).toEqual([{ state: 'unknown' }])
    f.proof.confirmNotApplied(String(effects[1]?.logical_key), 1, claim.restore, true)
    expect(f.proof.items(required(f.proof.claim('network', f.a)))).toHaveLength(2)
    expectProjection(f.proof)
  })

  it('keeps another network progressing while one consumer has unresolved effects', () => {
    const f = fixture(); seed(f)
    const blocked = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(blocked, 'item', 'synthetic-write'); f.proof.stop(blocked, true)
    f.proof.network('other')
    const source = f.proof.member('other'); const consumer = f.proof.member('other', ['input'])
    f.proof.acceptSource(f.proof.source('other', source), 'binding', [event()], 0, {})
    expect(f.proof.claim('network', f.a)).toBeNull()
    expect(f.proof.store.db.prepare('SELECT DISTINCT state FROM prototype_deliveries WHERE invocation_id=?').all(blocked.id)).toEqual([{ state: 'unknown' }])
    const healthy = required(f.proof.claim('other', consumer))
    f.proof.store.db.prepare('UPDATE prototype_networks SET activation_epoch=activation_epoch+1 WHERE id=\'network\'').run()
    f.proof.settle(healthy, [], [{ key: 'other-case', expectedRevision: 0, value: { done: true } }])
    expect(f.proof.store.db.prepare('SELECT revision FROM prototype_records WHERE network_id=\'other\'').get()?.revision).toBe(1)
    expect(f.proof.claim('network', f.a)).toBeNull()
    expectProjection(f.proof)
  })

  it('refuses a reused completed effect key with changed input', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(claim, 'item', 'synthetic-write'); f.proof.completeEffect(claim, 'item', 'synthetic-write'); f.proof.settle(claim)
    f.proof.acceptSource(f.proof.source('network', f.source), 'binding', [{ ...event(), sourceVersion: 'v2', payload: { changed: true } }], 1, {})
    expect(() => f.proof.beginEffect(required(f.proof.claim('network', f.a)), 'item', 'synthetic-write')).toThrow('input digest conflict')
    expect(count(f.proof, 'effect_attempts')).toBe(1)
  })

  it('refuses membership and activation-epoch changes while leaving other members valid', () => {
    const f = fixture(); seed(f)
    const a = required(f.proof.claim('network', f.a)); const b = required(f.proof.claim('network', f.b))
    f.proof.store.db.prepare('DELETE FROM prototype_members WHERE pod_id=?').run(f.a)
    expect(() => f.proof.settle(a)).toThrow('Obsolete')
    f.proof.assertCurrent(b)
    f.proof.store.db.prepare('UPDATE prototype_networks SET activation_epoch=activation_epoch+1').run()
    expect(() => f.proof.settle(b)).toThrow('Obsolete')
  })

  it('deduplicates derived emits and rolls back conflicting derived content', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    expect(() => f.proof.settle(claim, [event('result', 'output'), { ...event('result', 'output'), payload: { conflicting: true } }])).toThrow('conflicting')
    expect(count(f.proof, 'events')).toBe(1)
    f.proof.settle(claim, [event('result', 'output'), event('result', 'output')])
    expect(count(f.proof, 'events')).toBe(2)
    expect(count(f.proof, 'identities')).toBe(2)
  })

  it('retains acceptance markers through trace pruning and does not fan out old inputs again', () => {
    const f = fixture(); const ids = seed(f)
    f.proof.settle(required(f.proof.claim('network', f.a))); f.proof.settle(required(f.proof.claim('network', f.b)))
    f.proof.prune(Date.now() + 1)
    expect(count(f.proof, 'events')).toBe(0); expect(count(f.proof, 'identities')).toBe(1)
    expect(f.proof.acceptSource(f.proof.source('network', f.source), 'binding', [event()], 1, {})).toEqual(ids)
    expect(count(f.proof, 'events')).toBe(0); expect(count(f.proof, 'deliveries')).toBe(0)
    expectProjection(f.proof)
  })

  it('binds derived identity to declared causal inputs rather than the claim batch', () => {
    const f = fixture(); const ids = seed(f, [event('first'), event('second')])
    const claim = required(f.proof.claim('network', f.a))
    expect(() => f.proof.settle(claim, [{ ...event('result', 'output'), inputEventIds: ['foreign'] }])).toThrow('owned causal inputs')
    f.proof.settle(claim, [{ ...event('result', 'output'), inputEventIds: [ids[0]!] }])
    expect(count(f.proof, 'identities')).toBe(3)
  })

  it('rotates a restored snapshot nonce, pauses intake and preserves unresolved work', () => {
    const f = fixture(); seed(f)
    const claim = required(f.proof.claim('network', f.a))
    f.proof.beginEffect(claim, 'item', 'synthetic-write')
    const snapshot = join(f.root, 'snapshot.sqlite')
    f.proof.store.db.prepare('VACUUM INTO ?').run(snapshot)
    const restoredRoot = mkdtempSync(join(tmpdir(), 'pods-network-restored-')); roots.push(restoredRoot)
    copyFileSync(snapshot, join(restoredRoot, 'control.sqlite'))
    const restored = new NetworkPrototype(restoredRoot, true); stores.push(restored)
    expect(restored.store.db.prepare('SELECT state,restore_nonce FROM prototype_networks').get()).toEqual({ state: 'paused', restore_nonce: expect.not.stringMatching(claim.restore) })
    expect(count(restored, 'identities')).toBe(1)
    expect(count(restored, 'deliveries')).toBe(2)
    expect(count(restored, 'leases')).toBe(0)
    expect(restored.store.db.prepare('SELECT state FROM prototype_invocations WHERE id=?').get(claim.id)?.state).toBe('blocked')
    expect(restored.store.db.prepare('SELECT state FROM prototype_deliveries WHERE invocation_id=?').get(claim.id)?.state).toBe('unknown')
    expect(restored.store.db.prepare('SELECT d.state FROM prototype_deliveries d JOIN prototype_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.b)?.state).toBe('pending')
    expectProjection(restored)
    expect(restored.store.db.prepare('SELECT state FROM prototype_effect_attempts').get()?.state).toBe('unknown')
    expect(() => restored.acceptSource(claim, 'binding', [event()], 0, {})).toThrow('Obsolete')
    expect(() => restored.source('network', f.source)).toThrow('No active network binding')
  })

  it('cannot reuse old source authority after restart or restored nonce rotation', () => {
    const f = fixture(); const original = f.proof.source('network', f.source)
    reopen(f)
    expect(() => f.proof.acceptSource(original, 'binding', [event()], 0, {})).toThrow('Obsolete')
    f.proof.recoverStoppedProcesses()
    const current = f.proof.source('network', f.source)
    f.proof.store.db.prepare('UPDATE prototype_networks SET restore_nonce=?').run('different-restored-incarnation')
    expect(() => f.proof.acceptSource(current, 'binding', [event()], 0, {})).toThrow('Obsolete')
  })

  it.each<PrototypeCommitPoint>(['beforeAccepted', 'accepted', 'claimed', 'beforeSettlement', 'settled', 'effectIssued', 'effectConfirmed'])('survives actual process death at %s without partial progress or automatic uncertain effects', (point) => {
    const f = fixture(); const marker = join(f.root, 'synthetic-effect.txt')
    const module = fileURLToPath(new URL('./network-prototype.ts', import.meta.url))
    const code = `
      import { NetworkPrototype } from ${JSON.stringify(module)};
      import { writeFileSync } from 'node:fs';
      const p = new NetworkPrototype(${JSON.stringify(f.root)});
      const die = () => process.kill(process.pid, 'SIGKILL');
      const source = p.source('network', ${JSON.stringify(f.source)});
      p.acceptSource(source, 'binding', [${JSON.stringify(event())}], 0, { cursor: 'page-2' }, () => { if (${JSON.stringify(point)} === 'beforeAccepted') die(); });
      if (${JSON.stringify(point)} === 'accepted') die();
      const claim = p.claim('network', ${JSON.stringify(f.a)});
      if (${JSON.stringify(point)} === 'claimed') die();
      if (['effectIssued','effectConfirmed'].includes(${JSON.stringify(point)})) {
        p.beginEffect(claim, 'item', 'synthetic-write');
        writeFileSync(${JSON.stringify(marker)}, 'issued-once');
        if (${JSON.stringify(point)} === 'effectConfirmed') p.completeEffect(claim, 'item', 'synthetic-write');
        die();
      }
      p.settle(claim, [${JSON.stringify(event('result', 'output'))}], [{ key: 'record', expectedRevision: 0, value: { done: true } }], () => {
        if (${JSON.stringify(point)} === 'beforeSettlement') die();
      });
      if (${JSON.stringify(point)} === 'settled') die();
    `
    const child = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
    expect(child.signal, child.stderr).toBe('SIGKILL')
    reopen(f); f.proof.recoverStoppedProcesses()
    const completed = point === 'settled'
    expect(count(f.proof, 'events')).toBe(point === 'beforeAccepted' ? 0 : completed ? 2 : 1)
    expect(count(f.proof, 'identities')).toBe(point === 'beforeAccepted' ? 0 : completed ? 2 : 1)
    expect(count(f.proof, 'leases')).toBe(0)
    expect(f.proof.store.db.prepare('SELECT revision FROM prototype_checkpoints WHERE pod_id=?').get(f.source)?.revision).toBe(point === 'beforeAccepted' ? 0 : 1)
    expect(count(f.proof, 'records')).toBe(completed ? 1 : 0)
    expect(f.proof.store.db.prepare('SELECT revision FROM prototype_checkpoints WHERE pod_id=?').get(f.a)?.revision).toBe(completed ? 1 : 0)
    if (point === 'effectIssued') {
      expect(readFileSync(marker, 'utf8')).toBe('issued-once')
      expect(f.proof.claim('network', f.a)).toBeNull()
      expect(f.proof.store.db.prepare('SELECT state FROM prototype_effect_attempts').get()?.state).toBe('unknown')
      const attempt = f.proof.source('network', f.a)
      expect(() => f.proof.beginEffect(attempt, 'item', 'synthetic-write')).toThrow('requires reconciliation')
      f.proof.stop(attempt, true)
      expect(f.proof.store.db.prepare('SELECT state FROM prototype_deliveries d JOIN prototype_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.a)?.state).toBe('unknown')
    }
    else {
      const retry = f.proof.claim('network', f.a)
      expect(retry !== null).toBe(!completed && point !== 'beforeAccepted')
      if (point === 'effectConfirmed') {
        expect(readFileSync(marker, 'utf8')).toBe('issued-once')
        expect(f.proof.beginEffect(required(retry), 'item', 'synthetic-write')).toBe(false)
        f.proof.settle(required(retry))
      }
    }
    expect(f.proof.claim('network', f.b) !== null).toBe(point !== 'beforeAccepted')
  })
})
