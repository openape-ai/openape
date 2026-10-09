<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { t } from '../i18n'
import { ago } from '../utils/cadence'
import { buildModel, canvasWidth, clusterAt, colorResolver, curve, edgeWidth, hitTest, particleCount, pointAt, relayout, step, visibleNodes, boxSize, YOU } from '../utils/automation-layout'
import type { Layers, MapModel, MapNode } from '../utils/automation-layout'

/**
 * The animated map. Geometry comes from `utils/automation-layout`; this component only draws,
 * animates and reports hits. Hover and pin are reported to the owner of the info panel.
 */
const props = defineProps<{ view: MapView, group: string, layers: Layers, pinned: string | null, playing: boolean, now: number }>()
const emit = defineEmits<{ hover: [id: string | null], pin: [id: string | null], open: [id: string] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const model = shallowRef<MapModel>(relayout(buildModel(props.view), props.view, props.group, props.layers))
const visible = shallowRef(visibleNodes(model.value, props.group, props.layers))
const height = ref(model.value.height)
let hover: string | null = null
let frame = 0
let last = 0
const particles: { link: number, t: number, s: number }[] = []
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function rebuild(keepPositions = true) {
  model.value = relayout(buildModel(props.view, keepPositions ? model.value : undefined), props.view, props.group, props.layers)
  visible.value = visibleNodes(model.value, props.group, props.layers)
  height.value = model.value.height
  particles.length = 0
  model.value.links.forEach((link, index) => { const count = particleCount(link.flow); for (let k = 0; k < count; k++) particles.push({ link: index, t: (k / count + index * 0.07) % 1, s: 0.0001 + ((index * 7) % 5) * 0.00002 }) })
}
watch(() => props.view, () => rebuild())
watch(() => [props.group, props.layers.channel, props.layers.read, props.layers.write, props.layers.auth, props.layers.paused], () => rebuild())

let resolve: ((token: string) => string) | null = null
let scheme = ''
/** Canvas needs resolved colours; one probe per colour scheme turns the light-dark() tokens into rgb. */
function css() {
  const current = `${document.documentElement.style.colorScheme}|${matchMedia('(prefers-color-scheme: dark)').matches}`
  if (!resolve || scheme !== current) { scheme = current; resolve = colorResolver(canvas.value!.parentElement!) }
  return resolve
}
const font = (size: number, weight = 400) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) { if (ctx.measureText(text).width <= width) return text; let a = text; while (a.length > 1 && ctx.measureText(`${a}…`).width > width) a = a.slice(0, -1); return `${a}…` }
const nodeName = (item: MapNode) => item.id === YOU ? t('You · Pods inbox') : item.name
const nodeSub = (item: MapNode) => item.kind === 'collapsed' ? t('{count} Pods · paused', { count: Number(item.sub) }) : item.id === YOU ? t('questions, rules') : item.sub === 'idp' ? t('approvals: once / standing') : item.rk === 'application' ? `${item.sub} · ${t('installed')}` : item.rk === 'service' ? `${t('https')} · ${item.sub}` : item.rk === 'ssh' ? t('SSH · read only') : item.sub

function draw(now: number) {
  const element = canvas.value; const ctx = element?.getContext('2d')
  if (!element || !ctx) return
  if (element.height !== height.value) element.height = height.value
  const g = css(); const text = g('--text'); const muted = g('--muted'); const surface = g('--surface'); const border = g('--border')
  const colors = { channel: g('--accent'), read: g('--read'), write: g('--warn'), auth: g('--idp') }
  const dt = props.playing ? now - last : 0; last = now
  step(model.value, reduced ? 1 : 0.14)
  const nodes = new Map(model.value.nodes.map(item => [item.id, item]))
  const shown = (id: string) => visible.value.has(id)
  ctx.clearRect(0, 0, element.width, element.height)
  ctx.fillStyle = g('--tint')
  for (const cluster of model.value.clusters) {
    ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.roundRect(cluster.x, cluster.y, cluster.w, cluster.h, 16); ctx.fill(); ctx.globalAlpha = 1
    ctx.fillStyle = muted; ctx.font = font(12, 600); ctx.textAlign = 'left'
    const automation = props.view.automations.find(item => item.id === cluster.id)
    const facts = automation ? [automation.name.toUpperCase(), automation.schedule?.spec?.kind === 'interval' ? t('every {count} min', { count: automation.schedule.spec.seconds / 60 }) : automation.schedule?.spec?.kind === 'daily' ? t('daily {time}', { time: automation.schedule.spec.time }) : '', automation.counts.done ? t('{count} deliveries', { count: automation.counts.done }) : '', automation.lastRun ? `${t('last')} ${ago(automation.lastRun.at, props.now)}` : ''].filter(Boolean) : [cluster.name]
    ctx.fillText(fit(ctx, facts.join(' · '), cluster.w - 24), cluster.x + 12, cluster.y + 18)
    ctx.fillStyle = g('--tint')
  }
  const labels: { x: number, y: number, text: string }[] = []
  const focus = hover ?? props.pinned
  model.value.links.forEach((link) => {
    const a = nodes.get(link.from); const b = nodes.get(link.to)
    if (!a || !b || !props.layers[link.type] || !shown(a.id) || !shown(b.id)) return
    const paused = a.paused || b.paused
    const c = curve(a, b, link.type)
    ctx.strokeStyle = colors[link.type]; ctx.globalAlpha = paused ? 0.18 : link.flow > 0 ? (a.kind === 'ai' ? 0.35 : 0.6) : 0.2; ctx.lineWidth = edgeWidth(link.flow)
    ctx.setLineDash(link.type === 'channel' && link.flow > 0 ? [] : [5, 4])
    ctx.beginPath(); ctx.moveTo(c.p0.x, c.p0.y); ctx.quadraticCurveTo(c.c.x, c.c.y, c.p1.x, c.p1.y); ctx.stroke()
    const q = pointAt(c, 0.97); const q2 = pointAt(c, 1); const angle = Math.atan2(q2.y - q.y, q2.x - q.x)
    ctx.setLineDash([]); ctx.fillStyle = colors[link.type]; ctx.beginPath(); ctx.moveTo(q2.x, q2.y); ctx.lineTo(q2.x - 8 * Math.cos(angle - 0.4), q2.y - 8 * Math.sin(angle - 0.4)); ctx.lineTo(q2.x - 8 * Math.cos(angle + 0.4), q2.y - 8 * Math.sin(angle + 0.4)); ctx.fill()
    if (focus === a.id || focus === b.id) { const m = pointAt(c, focus === a.id ? 0.28 : 0.72); labels.push({ x: m.x, y: m.y, text: `${link.label || t('access')} · ${link.flow} · 24 h` }) }
  })
  ctx.globalAlpha = 1; ctx.setLineDash([])
  for (const particle of particles) {
    const link = model.value.links[particle.link]!; const a = nodes.get(link.from); const b = nodes.get(link.to)
    if (!a || !b || !props.layers[link.type] || !shown(a.id) || !shown(b.id) || a.paused || b.paused) continue
    particle.t = (particle.t + particle.s * dt) % 1
    const q = pointAt(curve(a, b, link.type), particle.t)
    ctx.fillStyle = colors[link.type]; ctx.beginPath(); ctx.arc(q.x, q.y, link.type === 'channel' ? 3.2 : 2.6, 0, 7); ctx.fill()
  }
  const pulse = 0.5 + 0.5 * Math.sin(now / 500)
  for (const item of model.value.nodes) {
    if (!shown(item.id)) continue
    ctx.globalAlpha = item.paused ? 0.35 : 1
    if (item.kind === 'pod') {
      const pod = props.view.pods.find(pod => pod.id === item.id)
      const fresh = !!pod?.lastRun && pod.lastRun.state !== 'running' && props.now - pod.lastRun.at < 20 * 60000
      if (item.blocked || item.degraded) { ctx.strokeStyle = item.blocked ? g('--bad') : g('--warn'); ctx.lineWidth = 2; ctx.globalAlpha = 0.35 + 0.5 * pulse; ctx.beginPath(); ctx.arc(item.x, item.y, 24 + 4 * pulse, 0, 7); ctx.stroke(); ctx.globalAlpha = 1 }
      if (item.running) { ctx.strokeStyle = g('--accent'); ctx.lineWidth = 2; ctx.globalAlpha = 0.3 + 0.5 * pulse; ctx.beginPath(); ctx.arc(item.x, item.y, 23, 0, 7); ctx.stroke(); ctx.globalAlpha = 1 }
      ctx.fillStyle = focus === item.id ? g('--tint') : fresh ? g('--ok-soft') : surface
      ctx.strokeStyle = item.blocked ? g('--bad') : item.degraded ? g('--warn') : item.ai ? g('--accent') : text; ctx.lineWidth = item.ai ? 2.4 : 1.4
      ctx.beginPath(); ctx.arc(item.x, item.y, 18, 0, 7); ctx.fill(); ctx.stroke()
      if (item.ai) { ctx.fillStyle = g('--accent'); ctx.font = font(10, 600); ctx.textAlign = 'center'; ctx.fillText(t('AI'), item.x, item.y + 4) }
      if (item.secrets) { ctx.fillStyle = g('--warn'); ctx.beginPath(); ctx.arc(item.x + 14, item.y - 13, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = font(9, 600); ctx.textAlign = 'center'; ctx.fillText('⚿', item.x + 14, item.y - 10) }
      ctx.fillStyle = text; ctx.font = font(12, 500); ctx.textAlign = 'center'; ctx.fillText(fit(ctx, item.name, item.labelWidth), item.x, item.y + 34)
      if (pod?.lastRun) { ctx.fillStyle = muted; ctx.font = font(10); ctx.fillText(pod.lastRun.state === 'running' ? t('running') : ago(pod.lastRun.at, props.now), item.x, item.y + 46) }
      continue
    }
    const { w, h } = boxSize(item.kind); const x = item.x - w / 2; const y = item.y - h / 2
    const stroke = item.kind === 'auth' ? g('--idp') : item.kind === 'ai' ? g('--accent') : item.rk === 'directory' ? g('--warn') : item.rk === 'application' ? g('--application') : item.rk === 'service' ? g('--service') : text
    ctx.fillStyle = focus === item.id ? g('--tint') : surface; ctx.strokeStyle = stroke; ctx.lineWidth = item.kind === 'auth' ? 2 : 1.4; ctx.setLineDash(item.kind === 'collapsed' ? [4, 4] : [])
    const radius = item.kind === 'auth' || item.rk === 'service' ? 20 : item.rk === 'directory' ? 4 : 8
    ctx.beginPath()
    if (item.rk === 'directory') { ctx.moveTo(x, y + 8); ctx.lineTo(x + 22, y + 8); ctx.lineTo(x + 28, y + 2); ctx.lineTo(x + w, y + 2); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath() }
    else {
      ctx.roundRect(x, y, w, h, radius)
    }
    ctx.fill(); ctx.stroke(); ctx.setLineDash([])
    const gx = x + 16; const gy = item.y; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2
    if (item.rk === 'service') { ctx.beginPath(); ctx.arc(gx, gy, 6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.ellipse(gx, gy, 2.5, 6, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(gx - 6, gy); ctx.lineTo(gx + 6, gy); ctx.stroke() }
    else if (item.rk === 'application') { for (const [dx, dy] of [[-6, -6], [1, -6], [-6, 1], [1, 1]]) { ctx.beginPath(); ctx.roundRect(gx + dx!, gy + dy!, 5, 5, 1); ctx.stroke() } }
    else if (item.rk === 'directory') { ctx.beginPath(); ctx.roundRect(gx - 7, gy - 4, 14, 10, 1.5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(gx - 7, gy - 4); ctx.lineTo(gx - 7, gy - 7); ctx.lineTo(gx - 2, gy - 7); ctx.lineTo(gx, gy - 4); ctx.stroke() }
    if (item.both) { ctx.fillStyle = g('--warn'); ctx.fillRect(x + w - 4, y + 6, 4, h - 12) }
    ctx.fillStyle = text; ctx.textAlign = 'left'; ctx.font = font(12, 600)
    const glyph = !!item.rk && item.kind !== 'collapsed'; const tx = glyph ? x + 30 : item.x; const tw = glyph ? w - 38 : w - 16
    if (!glyph) ctx.textAlign = 'center'
    const sub = nodeSub(item)
    ctx.fillText(fit(ctx, nodeName(item), tw), tx, item.y - (sub ? 2 : -4))
    if (sub) { ctx.fillStyle = muted; ctx.font = font(11); ctx.fillText(fit(ctx, sub, tw), tx, item.y + 13) }
    if (item.badge) { ctx.fillStyle = g('--bad'); ctx.beginPath(); ctx.arc(x + w - 4, y + 4, 11, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = font(11, 600); ctx.textAlign = 'center'; ctx.fillText(String(item.badge), x + w - 4, y + 8) }
  }
  ctx.globalAlpha = 1; ctx.font = `11px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'
  for (const label of labels) { const w = ctx.measureText(label.text).width + 10; ctx.fillStyle = surface; ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(label.x - w / 2, label.y - 9, w, 18, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = text; ctx.fillText(label.text, label.x, label.y + 4) }
}
function loop(now: number) { draw(now); frame = requestAnimationFrame(loop) }
onMounted(() => { rebuild(false); if (canvas.value?.getContext('2d')) frame = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(frame))

function position(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) * canvasWidth / rect.width, y: (event.clientY - rect.top) * height.value / rect.height }
}
function move(event: MouseEvent) {
  const p = position(event); const item = hitTest(model.value, visible.value, p.x, p.y)
  const id = item?.id ?? null
  if (id !== hover) { hover = id; emit('hover', id) }
  canvas.value!.style.cursor = item || clusterAt(model.value, p.x, p.y) ? 'pointer' : 'default'
}
function click(event: MouseEvent) {
  const p = position(event); const item = hitTest(model.value, visible.value, p.x, p.y)
  if (!item) { const cluster = clusterAt(model.value, p.x, p.y); if (cluster) { emit('open', cluster.id); return } }
  emit('pin', item ? (props.pinned === item.id ? null : item.id) : null)
}
function doubleClick(event: MouseEvent) {
  const p = position(event); const item = hitTest(model.value, visible.value, p.x, p.y)
  if (item) { emit('pin', item.id); emit('open', item.id) }
}
function leave() { if (hover) { hover = null; emit('hover', null) } }
defineExpose({ model, visible, css })
</script>

<template>
  <div class="automations-map" data-testid="automations-map">
    <canvas ref="canvas" :width="canvasWidth" :height="height" role="img" :aria-label="t('Animated map of all Pods with their data sources, stores and decision points')" @mousemove="move" @click="click" @dblclick="doubleClick" @mouseleave="leave" />
  </div>
</template>

<style>
.automations-map{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;min-width:0}
.automations-map canvas{display:block;width:100%;height:auto}
</style>
