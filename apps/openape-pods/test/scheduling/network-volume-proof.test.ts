// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { NetworkPrototype } from './network-prototype'
import type { PrototypeEvent } from './network-prototype-types'

it('measures the approved synthetic volume and bounded projection fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-network-volume-'))
  const proof = new NetworkPrototype(root)
  mkdirSync('/tmp/openape-pods-networks-m1', { recursive: true })
  const checkProjection = () => expect(proof.projection()).toEqual(proof.store.db.prepare('SELECT s.network_id,d.state,count(*) AS count FROM prototype_deliveries d JOIN prototype_subscriptions s ON s.id=d.subscription_id GROUP BY s.network_id,d.state ORDER BY s.network_id,d.state').all())
  const samples: Record<string, number[]> = { acceptance: [], settlement: [], dispatch: [], projection: [] }
  const initialMemory = process.memoryUsage().rss
  const events = (batch: number): PrototypeEvent[] => Array.from({ length: 500 }, (_, item) => ({ key: `${batch}-${item}`, channel: 'input', sourceVersion: 'v1', payload: { key: `${batch}-${item}`, text: 'x'.repeat(980) } }))
  const networks = Array.from({ length: 3 }, (_, index) => {
    const id = `network-${index}`; proof.network(id)
    const source = proof.member(id)
    const held = proof.member(id, ['input']); const failed = proof.member(id, ['input'])
    const branches = Array.from({ length: 3 }, (_, branch) => Array.from({ length: 5 }, (_, stage) => proof.member(id, [stage === 0 ? 'input' : `branch-${branch}-stage-${stage}`])))
    return { id, source, held, failed, branches }
  })
  const count = (table: string) => Number(proof.store.db.prepare(`SELECT count(*) AS count FROM prototype_${table}`).get()?.count)
  const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
  try {
    for (let batch = 0; batch < 10; batch++) {
      for (const network of networks) {
        let start = performance.now()
        proof.acceptSource(proof.source(network.id, network.source), 'binding', events(batch), batch, { batch })
        samples.acceptance.push(performance.now() - start)
        if (batch === 0) {
          for (const pod of [network.held, network.failed]) {
            const invocation = proof.claim(network.id, pod)
            expect(invocation).not.toBeNull()
            proof.stop(invocation!, true)
          }
        }
        for (const [pod, state] of [[network.held, 'blocked'], [network.failed, 'blocked']]) {
          proof.store.db.prepare('UPDATE prototype_deliveries SET state=? WHERE subscription_id IN (SELECT id FROM prototype_subscriptions WHERE pod_id=?)').run(state, pod)
        }
        for (const [branch, stages] of network.branches.entries()) {
          for (const [stage, pod] of stages.entries()) {
            while (true) {
              start = performance.now()
              const invocation = proof.claim(network.id, pod)
              if (!invocation) break
              samples.dispatch.push(performance.now() - start)
              const items = proof.items(invocation)
              const emits = stage === 4 ? [] : items.map(item => ({ ...item, inputEventIds: [item.eventId], channel: `branch-${branch}-stage-${stage + 1}` }))
              const writes = branch === 0 && stage === 4
                ? items.flatMap(item => [
                    { key: item.key, expectedRevision: 0, value: { status: 'staged' } },
                    { key: item.key, expectedRevision: 1, value: { status: 'completed' } },
                  ])
                : []
              start = performance.now(); proof.settle(invocation, emits, writes)
              samples.settlement.push(performance.now() - start)
            }
          }
        }
      }
    }
    const tableBytesBefore = proof.store.db.prepare('SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name').all()
    const walBytesBefore = statSync(`${proof.store.path}-wal`).size
    checkProjection()
    const rowsBefore = { events: count('events'), deliveries: count('deliveries'), identities: count('identities'), records: count('records'), versions: count('record_revisions') }
    expect(rowsBefore.records).toBe(15000); expect(rowsBefore.versions).toBe(30000)
    const dbBefore = Number(proof.store.db.prepare('PRAGMA page_count').get()?.page_count) * Number(proof.store.db.prepare('PRAGMA page_size').get()?.page_size)
    const projections: string[] = []
    for (let index = 0; index < 20; index++) {
      const start = performance.now(); projections.push(JSON.stringify(proof.projection())); samples.projection.push(performance.now() - start)
    }
    const projectionBytes = Buffer.byteLength(projections[0]!)
    expect(projectionBytes).toBeLessThan(32 * 1024 * 1024)
    proof.prune(Date.now() + 1)
    checkProjection()
    const rowsAfter = { events: count('events'), deliveries: count('deliveries'), identities: count('identities') }
    expect(rowsAfter.identities).toBe(rowsBefore.identities)
    expect(rowsAfter.events).toBe(15000)
    expect(rowsAfter.deliveries).toBe(30000)
    const compactedPath = join(root, 'compacted.sqlite')
    proof.store.db.prepare('VACUUM INTO ?').run(compactedPath)
    const compactedBytes = statSync(compactedPath).size
    expect(compactedBytes).toBeLessThan(256 * 1024 * 1024)
    const tableBytesAfter = proof.store.db.prepare('SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name').all()
    for (const network of networks) {
      proof.acceptSource(proof.source(network.id, network.source), 'binding', events(0), 10, { duplicate: true })
      expect(proof.claim(network.id, network.branches[0]![0]!)).toBeNull()
    }
    const deepBacklogSamples: number[] = []
    const backlog = networks[0]!
    proof.store.db.prepare('UPDATE prototype_deliveries SET state=\'pending\' WHERE subscription_id IN (SELECT id FROM prototype_subscriptions WHERE pod_id=?)').run(backlog.failed)
    while (true) {
      const start = performance.now(); const invocation = proof.claim(backlog.id, backlog.failed)
      if (!invocation) break
      deepBacklogSamples.push(performance.now() - start); proof.settle(invocation)
    }
    expect(deepBacklogSamples).toHaveLength(100)
    checkProjection()
    const measurement = { deepBacklogAcquisitionMs: { initialPending: 5000, samples: deepBacklogSamples.length, p50: percentile(deepBacklogSamples, 0.5), p95: percentile(deepBacklogSamples, 0.95) }, environment: { journalMode: proof.store.db.prepare('PRAGMA journal_mode').get()?.journal_mode, synchronous: proof.store.db.prepare('PRAGMA synchronous').get()?.synchronous, node: process.version, sqlite: proof.store.db.prepare('SELECT sqlite_version() AS version').get()?.version, platform: platform(), architecture: arch(), kernel: release(), cpu: cpus()[0]?.model }, tableBytesBefore, tableBytesAfter, walBytesBefore, compactedBytes, fixture: { networks: 3, batches: 10, itemsPerBatch: 500, stages: 5, consumers: 3, writesPerCase: 2, blockedConsumerPodsPerNetwork: 2 }, rowsBefore, rowsAfter, databaseBytesBeforeRetention: dbBefore, databaseFileBytes: statSync(proof.store.path).size, rssIncreaseBytes: process.memoryUsage().rss - initialMemory, projectionBytes, timingsMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) }])), limits: ['Dispatch measures ready-queue acquisition with a free synthetic slot, not production scheduler latency.', 'Projection measures bounded local summary serialization; authenticated relay publication is deferred to M10.', 'Held/blocked fixtures retain durable queue state; real gate maintenance is deferred to M5.', 'Compacted bytes measure VACUUM INTO, matching the existing backup database snapshot mechanism.', 'RSS is a Vitest-worker endpoint delta with GC/sample-array noise, not a memory ceiling.', 'Acceptance samples contain 500 items and five initial subscribers; settlement samples contain 50 items, up to 50 emits or 100 record writes.', 'SIGKILL tests establish process-crash atomicity; power-loss durability and macOS fullfsync are not claimed.'] }
    writeFileSync('/tmp/openape-pods-networks-m1/volume-final.json', JSON.stringify(measurement, null, 2))
    console.log(JSON.stringify({ settlementTargetMet: measurement.timingsMs.settlement.p95 < 100, freeSlotAcquisitionTargetMet: measurement.timingsMs.dispatch.p95 < 2000 }))
  }
  finally { proof.close(); rmSync(root, { recursive: true, force: true }) }
}, 120000)
