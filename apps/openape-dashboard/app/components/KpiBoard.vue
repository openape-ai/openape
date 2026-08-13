<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderMarkdown } from '~/utils/markdown'
import {
  doneSummary,
  formatAge,
  formatValue,
  missingRest,
  summaryChips,
  themeGroups,
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

const groups = computed(() => themeGroups(props.kpis))
const chips = computed(() => summaryChips(props.kpis))
const done = computed(() => doneSummary(props.kpis))
const total = computed(() => totalWaiting(props.kpis))
const newest = computed(() => Math.max(0, ...props.kpis.map(k => k.createdAt)))
const today = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })

const chipTargets = computed(() => new Map(props.kpis.map(k => [k.id, k.key])))

// Details sind der Inhalt: Themen-Kacheln default offen, Chevron klappt zu.
const userToggled = ref(new Map<string, boolean>())

function isOpen(key: string): boolean {
  return userToggled.value.get(key) ?? true
}

function toggle(key: string) {
  const next = new Map(userToggled.value)
  next.set(key, !isOpen(key))
  userToggled.value = next
}

// Leere „erledigt"-Mitglieder brauchen keine Detail-Box — eine Zeile reicht.
const renderedDetails = computed(() => {
  const map = new Map<string, { html: string, missing: number }>()
  for (const kpi of props.kpis) {
    if (kpi.detail && kpi.value > 0) {
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
          :href="`#theme-${chipTargets.get(chip.id)}`"
          class="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-sm font-medium text-amber-300 hover:bg-amber-400/20"
        >
          {{ chip.text }}
        </a>
      </div>
      <p v-if="done.length" class="mt-3 text-sm text-emerald-300/90">
        Versorgt: {{ done.join(' · ') }}
      </p>
    </div>

    <div v-if="!groups.length" class="py-16 text-center text-zinc-400">
      <p class="text-lg">
        Noch keine KPIs.
      </p>
      <p class="mt-2 text-sm">
        Der erste Push: <code class="text-zinc-300">ape-kpi push demo.test 1</code>
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <article
        v-for="group in groups"
        :id="`theme-${group.key}`"
        :key="group.key"
        class="scroll-mt-4 rounded-xl border bg-zinc-900/40"
        :class="group.tone === 'attention' ? 'border-amber-400/25' : 'border-zinc-800/80'"
      >
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3">
          <span class="min-w-0 flex-1 text-sm font-medium text-zinc-200">{{ group.label }}</span>
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span class="text-2xl font-semibold tabular-nums" :class="NUMBER_TONE[group.tone]">{{ group.total }}</span>
            <span v-if="group.unit" class="text-xs text-zinc-400">{{ group.unit }}</span>
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              :icon="isOpen(group.key) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-label="`${group.label} ${isOpen(group.key) ? 'einklappen' : 'aufklappen'}`"
              :aria-expanded="isOpen(group.key)"
              :aria-controls="isOpen(group.key) ? `theme-body-${group.key}` : undefined"
              @click="toggle(group.key)"
            />
          </span>
        </header>

        <div v-if="isOpen(group.key)" :id="`theme-body-${group.key}`" class="border-t border-zinc-800/60 px-4 py-3">
          <section v-for="(kpi, i) in group.members" :key="kpi.id" :class="i > 0 ? 'mt-4' : ''">
            <div class="flex items-baseline gap-2" :title="`${kpi.scope} · ${kpi.key} · ${formatAge(kpi.createdAt)}`">
              <a v-if="kpi.link" :href="kpi.link" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold uppercase tracking-widest text-zinc-400 hover:text-sky-300 hover:underline">{{ topScope(kpi.scope) }}</a>
              <span v-else class="text-xs font-semibold uppercase tracking-widest text-zinc-400">{{ topScope(kpi.scope) }}</span>
              <span class="text-sm font-semibold tabular-nums" :class="NUMBER_TONE[kpi.value > 0 ? group.tone : 'done']">{{ formatValue(kpi) }}</span>
              <span v-if="kpi.value === 0" class="text-xs text-emerald-300/80">nichts wartet ✓</span>
              <span v-if="Date.now() - kpi.createdAt > 3600000" class="text-xs text-amber-300/80">{{ formatAge(kpi.createdAt) }}</span>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html — sanitized in renderMarkdown -->
            <div
              v-if="renderedDetails.has(kpi.id)"
              class="prose prose-invert prose-sm mt-1 max-w-none prose-a:text-sky-300 prose-li:my-0.5 prose-ul:my-0"
              v-html="renderedDetails.get(kpi.id)!.html"
            />
            <p v-if="renderedDetails.get(kpi.id)?.missing" class="mt-1.5 text-sm italic text-zinc-400">
              <a v-if="kpi.link" :href="kpi.link" target="_blank" rel="noopener noreferrer" class="hover:text-sky-300 hover:underline">… und {{ renderedDetails.get(kpi.id)!.missing }} weitere</a>
              <template v-else>
                … und {{ renderedDetails.get(kpi.id)!.missing }} weitere
              </template>
            </p>
          </section>
        </div>
      </article>
    </div>
  </div>
</template>
