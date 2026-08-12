<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderMarkdown } from '~/utils/markdown'
import {
  doneSummary,
  formatAge,
  formatValue,
  labelForKey,
  missingRest,
  orderedCards,
  summaryChips,
  toneForKey,
  topScope,
  totalWaiting,
} from '~/utils/kpi-display'

interface Kpi {
  id: string
  scope: string
  key: string
  value: number
  unit: string | null
  detail: string | null
  link: string | null
  createdAt: number
}

const props = defineProps<{ kpis: Kpi[] }>()

const cards = computed(() => orderedCards(props.kpis))
const chips = computed(() => summaryChips(props.kpis))
const done = computed(() => doneSummary(props.kpis))
const total = computed(() => totalWaiting(props.kpis))
const newest = computed(() => Math.max(0, ...props.kpis.map(k => k.createdAt)))
const today = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })

// Details sind der Inhalt, nicht Beiwerk: default offen — außer bei leeren
// „erledigt"-Karten (deren Detail sagt nur nochmal „nichts wartet").
const userToggled = ref(new Map<string, boolean>())

function defaultOpen(kpi: Kpi): boolean {
  return Boolean(kpi.detail) && !(kpi.value === 0 && toneForKey(kpi.key, kpi.value) === 'done')
}

function isOpen(kpi: Kpi): boolean {
  if (!kpi.detail)
    return false
  return userToggled.value.get(kpi.id) ?? defaultOpen(kpi)
}

function toggle(kpi: Kpi) {
  const next = new Map(userToggled.value)
  next.set(kpi.id, !isOpen(kpi))
  userToggled.value = next
}

const STALE_MS = 60 * 60 * 1000
function isStale(kpi: Kpi): boolean {
  return Date.now() - kpi.createdAt > STALE_MS
}

const renderedDetails = computed(() => {
  const map = new Map<string, { html: string, missing: number }>()
  for (const kpi of props.kpis) {
    if (kpi.detail) {
      const html = renderMarkdown(kpi.detail)
      map.set(kpi.id, { html, missing: missingRest(kpi.value, html) })
    }
  }
  return map
})

const NUMBER_TONE: Record<string, string> = {
  attention: 'text-amber-300',
  done: 'text-emerald-300',
  neutral: 'text-zinc-100',
}
</script>

<template>
  <div>
    <div class="mb-8">
      <p class="text-sm text-zinc-400">
        {{ today }}<span v-if="kpis.length"> · Stand {{ formatAge(newest) }}</span>
      </p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">
        <template v-if="total">
          <span class="text-amber-300">{{ total }} Punkte</span> warten
        </template>
        <template v-else-if="kpis.length">
          Alles versorgt <span class="text-emerald-300">✓</span>
        </template>
        <template v-else>
          Dein Briefing
        </template>
      </h1>
      <div v-if="chips.length" class="mt-3 flex flex-wrap gap-2">
        <a
          v-for="chip in chips"
          :key="chip.id"
          :href="`#kpi-${chip.id}`"
          class="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-sm font-medium text-amber-300 hover:bg-amber-400/20"
        >
          {{ chip.text }}
        </a>
      </div>
      <p v-if="done.length" class="mt-3 text-sm text-emerald-300/90">
        Versorgt: {{ done.join(' · ') }}
      </p>
    </div>

    <div v-if="!cards.length" class="py-16 text-center text-zinc-400">
      <p class="text-lg">
        Noch keine KPIs.
      </p>
      <p class="mt-2 text-sm">
        Der erste Push: <code class="text-zinc-300">ape-kpi push demo.test 1</code>
      </p>
    </div>

    <div class="grid items-start gap-3 lg:grid-cols-2">
      <article
        v-for="kpi in cards"
        :id="`kpi-${kpi.id}`"
        :key="kpi.id"
        class="scroll-mt-4 rounded-xl border bg-zinc-900/40"
        :class="toneForKey(kpi.key, kpi.value) === 'attention' ? 'border-amber-400/25' : 'border-zinc-800/80'"
      >
        <header
          class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 pt-3"
          :class="isOpen(kpi) ? '' : 'pb-3'"
          :title="`${kpi.scope} · ${kpi.key} · ${formatAge(kpi.createdAt)}`"
        >
          <span class="text-xs font-semibold uppercase tracking-widest text-zinc-400">{{ kpi.scope }}</span>
          <span class="min-w-0 flex-1 basis-full text-sm font-medium text-zinc-200 sm:basis-auto">
            <a v-if="kpi.link" :href="kpi.link" target="_blank" rel="noopener noreferrer" class="hover:text-sky-300 hover:underline">{{ labelForKey(kpi.key) }}</a>
            <template v-else>{{ labelForKey(kpi.key) }}</template>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span class="text-2xl font-semibold tabular-nums" :class="NUMBER_TONE[toneForKey(kpi.key, kpi.value)]">
              {{ formatValue(kpi) }}
            </span>
            <span v-if="kpi.unit" class="text-xs text-zinc-400">{{ kpi.unit }}</span>
            <span v-if="isStale(kpi)" class="text-xs text-amber-300/80">{{ formatAge(kpi.createdAt) }}</span>
            <UButton
              v-if="kpi.detail"
              size="sm"
              variant="ghost"
              color="neutral"
              :icon="isOpen(kpi) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-label="`Details zu ${labelForKey(kpi.key)} (${topScope(kpi.scope)}) ${isOpen(kpi) ? 'einklappen' : 'zeigen'}`"
              :aria-expanded="isOpen(kpi)"
              :aria-controls="isOpen(kpi) ? `detail-${kpi.id}` : undefined"
              @click="toggle(kpi)"
            />
          </span>
        </header>
        <div
          v-if="isOpen(kpi)"
          :id="`detail-${kpi.id}`"
          class="mt-1 border-t border-zinc-800/60 px-4 py-3"
        >
          <!-- eslint-disable-next-line vue/no-v-html — sanitized in renderMarkdown -->
          <div
            class="prose prose-invert prose-sm max-w-none prose-a:text-sky-300 prose-li:my-0.5 prose-ul:my-0"
            v-html="renderedDetails.get(kpi.id)?.html ?? ''"
          />
          <p v-if="renderedDetails.get(kpi.id)?.missing" class="mt-1.5 text-sm italic text-zinc-400">
            <a v-if="kpi.link" :href="kpi.link" target="_blank" rel="noopener noreferrer" class="hover:text-sky-300 hover:underline">… und {{ renderedDetails.get(kpi.id)!.missing }} weitere</a>
            <template v-else>… und {{ renderedDetails.get(kpi.id)!.missing }} weitere</template>
          </p>
        </div>
      </article>
    </div>
  </div>
</template>
