<script setup lang="ts">
import { computed } from 'vue'

/**
 * A machine key's fingerprint drawn as rings (plan section 10). The same key
 * always gives the same seal, a new key a visibly different one. It helps
 * recognition; screens that ask for a decision still show the fingerprint text.
 */
const props = withDefaults(defineProps<{ fingerprint: string, size?: number, tone?: 'sky' | 'brass', ground?: boolean }>(), { size: 40, tone: 'sky', ground: false })

const RADII = [15, 24, 33, 42]

function arc(r: number, a1: number, a2: number): string {
  const rad = (a: number) => (a - 90) * Math.PI / 180
  const x1 = 50 + r * Math.cos(rad(a1))
  const y1 = 50 + r * Math.sin(rad(a1))
  const x2 = 50 + r * Math.cos(rad(a2))
  const y2 = 50 + r * Math.sin(rad(a2))
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const arcs = computed(() => {
  const hex = props.fingerprint.replace(/[^0-9a-f]/gi, '').toLowerCase() || '0'
  const digit = (i: number) => Number.parseInt(hex[i % hex.length]!, 16)
  const paths: string[] = []
  let k = 0
  for (const r of RADII) {
    const count = 2 + (digit(k++) % 2)
    const start = digit(k++) * 22.5
    const slot = 360 / count
    for (let j = 0; j < count; j++) {
      const length = slot * (0.3 + (digit(k++) / 15) * 0.5)
      paths.push(arc(r, start + j * slot, start + j * slot + length))
    }
  }
  return paths
})

const color = computed(() => props.tone === 'brass' ? '#D9B56E' : '#38BDF8')
const short = computed(() => props.fingerprint.slice(0, 16).match(/.{1,4}/g)?.join(' ') ?? '')
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 100 100" role="img" :aria-label="`Key seal ${short}`" class="shrink-0">
    <circle v-if="ground" cx="50" cy="50" r="49" fill="#221E15" />
    <g fill="none" :stroke="color" stroke-width="5" stroke-linecap="round">
      <path v-for="(d, i) in arcs" :key="i" :d="d" />
    </g>
    <circle cx="50" cy="50" r="6" :fill="color" />
  </svg>
</template>
