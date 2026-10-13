import type { MapPod, MapView } from '../../contracts/map-view'
import { diagnostic, t } from '../i18n'
import { ago, cadence } from './cadence'

/** What a Pod row tells the owner at a glance: state, last result, next run and what the Pod waits for. */
export type PodState = 'failing' | 'waiting' | 'running' | 'paused' | 'ok'

// Run summaries that only repeat the state carry no result for the owner.
const generic = new Set(['', 'Run failed', 'Run cancelled', 'Run completed'])

export function podState(pod: MapPod, view: MapView): PodState {
  if (pod.lifecycle !== 'active') return 'paused'
  if (view.kpis.degraded.some(item => item.podId === pod.id)) return 'failing'
  if (waitsFor(pod, view)) return 'waiting'
  if (pod.lastRun?.state === 'running') return 'running'
  return 'ok'
}

export function lastResult(pod: MapPod, now: number): string {
  const run = pod.lastRun
  if (!run) return t('no run yet')
  if (run.state === 'running') return t('running now')
  const when = ago(run.at, now)
  if (run.error && !['completed', 'completedWithGaps'].includes(run.state)) return `${when} · ${diagnostic(run.error)}`
  return `${when} · ${generic.has(run.summary) ? diagnostic(run.state) : run.summary}`
}

export function nextRun(pod: MapPod, now: number): string {
  if (pod.lifecycle !== 'active') return t('paused')
  const schedule = pod.schedule
  const rhythm = cadence(schedule, pod.data.reads)
  if (!schedule?.enabled || !schedule.spec) return pod.data.reads.length ? t('on new shared data') : t('manual only')
  if (!schedule.nextAt) return rhythm
  const minutes = Math.max(0, Math.round((schedule.nextAt - now) / 60000))
  return `${rhythm} · ${minutes < 1 ? t('due now') : minutes < 60 ? t('in {count} min', { count: minutes }) : t('in {count} h', { count: Math.round(minutes / 60) })}`
}

/** The first thing that holds the Pod, in the order the owner can resolve it; empty when nothing does. */
export function waitsFor(pod: MapPod, view: MapView): string {
  if (pod.approvals.length) return t('your approval at the IdP')
  if (view.kpis.decisions.some(item => item.podId === pod.id && item.kind === 'question')) return t('your answer')
  if (pod.work.held) return t('{count} held items for you', { count: pod.work.held })
  if (pod.unknown.length) return t('your check of an uncertain delivery')
  if (pod.queue.blocked) return pod.queue.error ? `${t('blocked')}: ${diagnostic(pod.queue.error)}` : t('blocked')
  return ''
}
