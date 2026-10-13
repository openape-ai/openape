import { afterEach, describe, expect, it } from 'vitest'
import type { MapPod, MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import { applyLanguage } from '../../src/renderer/i18n'
import { failureCount, lastResult, nextRun, podState, waitsFor } from '../../src/renderer/utils/pod-status'
import fixture from './map-view.json'

const view = parseMapView(fixture) as MapView
const NOW = view.at
const base = view.pods.find(pod => pod.name === 'zaz Service-Agent')!
const pod = (change: Partial<MapPod>): MapPod => ({ ...structuredClone(base), ...change })
afterEach(() => applyLanguage('en'))

describe('Pod row status', () => {
  it('names the failure cause instead of the generic summary', () => {
    applyLanguage('de')
    expect(lastResult(pod({ lastRun: { at: NOW - 5 * 60000, state: 'failed', summary: 'Run failed', error: 'Invalid program arguments' } }), NOW)).toBe('vor 5 min · Ungültige Programmargumente')
    expect(lastResult(pod({ lastRun: { at: NOW - 5 * 60000, state: 'completed', summary: 'Run completed', error: null } }), NOW)).toBe('vor 5 min · abgeschlossen')
  })

  it('shows the cadence with the time until the next scheduled run', () => {
    applyLanguage('de')
    expect(nextRun(pod({ schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true, nextAt: NOW + 4 * 60000 } }), NOW)).toBe('alle 15 min · in 4 min')
    expect(nextRun(pod({ schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: false, nextAt: null } }), NOW)).toBe('nur manuell')
    expect(nextRun(pod({ lifecycle: 'paused' }), NOW)).toBe('pausiert')
  })

  it('reports what holds the Pod and derives its state', () => {
    applyLanguage('de')
    const blocked = pod({ queue: { blocked: 1, error: 'Invalid program arguments' } })
    expect(waitsFor(blocked, view)).toBe('blockiert: Ungültige Programmargumente')
    expect(podState(blocked, view)).toBe('waiting')
    expect(waitsFor(pod({}), view)).toBe('')
    const requested = pod({ grants: [{ grantId: 'grant-push', title: 'Send push messages', url: 'https://id.openape.ai/grant-approval?grant_id=grant-push' }] })
    expect(waitsFor(requested, view)).toBe('deine Freigabe am IdP')
    expect(podState(requested, view)).toBe('waiting')
  })

  it('counts the failed runs of the last 24 hours, also after a successful last run', () => {
    applyLanguage('de')
    expect(failureCount(pod({ failures: 137 }))).toBe('137 fehlgeschlagene Läufe in 24 h')
    expect(failureCount(pod({ failures: 0 }))).toBe('')
    expect(failureCount(pod({ failures: undefined }))).toBe('')
  })
})
