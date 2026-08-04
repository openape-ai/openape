<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import { computed } from 'vue'
import { waitingLabel } from '../utils/attention-inbox'

// The card has to stand on its own: opened days later, on a phone, by someone
// who never saw the conversation. So the briefing (summary, per-option
// meaning, why the recommendation) stays visible AFTER the decision too — the
// resolution is appended, it does not replace the reasoning.
const props = defineProps<{
  event: WireEvent
  resolution?: WireEvent | null
  proofs?: WireEvent[]
  now: number
  submitting?: boolean
}>()
defineEmits<{ resolve: [{ choice?: string, verdict?: string }] }>()

const e = computed(() => props.event)
const isVerdict = computed(() => e.value.type === 'verdict.requested')
const question = computed(() => String(e.value.payload.question ?? ''))
const options = computed(() => (e.value.payload.options as string[] | undefined) ?? [])
const recommendation = computed(() => e.value.payload.recommendation as string | undefined)
const blocks = computed(() => e.value.payload.blocks as string | undefined)
const prUrl = computed(() => e.value.payload.pr_url as string | undefined)
const headline = computed(() => (e.value.payload.title as string | undefined) ?? (isVerdict.value ? e.value.task_ref : question.value))
const summary = computed(() => e.value.payload.summary as string | undefined)
const why = computed(() => e.value.payload.recommendation_why as string | undefined)
const highlights = computed(() => (e.value.payload.highlights as string[] | undefined) ?? [])
const optionSummaries = computed(() => {
  const list = (e.value.payload.option_summaries as { option: string, summary: string }[] | undefined) ?? []
  return Object.fromEntries(list.map(o => [o.option, o.summary]))
})
const verdictOptions = [
  { value: 'merge', label: 'Merge' },
  { value: 'rework', label: 'Nacharbeit' },
  { value: 'reject', label: 'Ablehnen' },
]
</script>

<template>
  <div class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
    <div class="flex items-center gap-2 mb-3">
      <span
        class="text-xs px-2 py-0.5 rounded"
        :class="isVerdict ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'"
      >
        {{ isVerdict ? 'Verdict' : (e.type === 'work.blocked' ? 'Eskalation' : 'Entscheidung') }}
      </span>
      <span v-if="blocks" class="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">blockiert {{ blocks }}</span>
      <span class="ml-auto text-xs text-zinc-400">{{ resolution ? 'entschieden' : waitingLabel(e, props.now) }}</span>
    </div>

    <h2 class="text-lg font-semibold mb-1">
      {{ headline }}
    </h2>
    <p class="text-xs text-zinc-400 font-mono mb-3">
      {{ e.actor }} · {{ e.task_ref }}
    </p>

    <p v-if="summary" class="text-sm text-zinc-300 leading-relaxed whitespace-pre-line mb-3">
      {{ summary }}
    </p>
    <ul v-if="highlights.length" class="text-sm text-zinc-400 mb-3 space-y-1">
      <li v-for="h in highlights" :key="h" class="flex gap-2">
        <span class="text-zinc-600">·</span>{{ h }}
      </li>
    </ul>
    <p v-if="isVerdict && question" class="text-sm text-zinc-300 mb-3">
      {{ question }}
    </p>

    <div v-if="isVerdict && (prUrl || (proofs?.length ?? 0))" class="flex flex-wrap gap-2 mb-4">
      <a v-if="prUrl" :href="prUrl" target="_blank" class="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500">
        PR ansehen ↗
      </a>
      <a
        v-for="p in proofs ?? []" :key="p.id" :href="String(p.payload.url)" target="_blank"
        class="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
      >
        Beweis: {{ p.payload.kind }} ↗
      </a>
    </div>

    <div v-if="!isVerdict && options.length" class="space-y-2 mb-4">
      <div
        v-for="option in options" :key="option"
        class="rounded-lg border px-3 py-2"
        :class="option === recommendation ? 'border-primary-600/60 bg-primary-500/5' : 'border-zinc-800'"
      >
        <div class="flex items-center gap-2 text-sm font-medium">
          {{ option }}
          <span v-if="option === recommendation" class="text-[10px] uppercase tracking-wide text-primary-400">Empfehlung</span>
        </div>
        <p v-if="optionSummaries[option]" class="text-xs text-zinc-400 mt-1 leading-relaxed">
          {{ optionSummaries[option] }}
        </p>
      </div>
    </div>

    <div v-if="why" class="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 mb-4">
      <p class="text-xs uppercase tracking-wide text-zinc-500 mb-1">
        Warum diese Empfehlung
      </p>
      <p class="text-sm text-zinc-300 leading-relaxed">
        {{ why }}
      </p>
    </div>

    <template v-if="!resolution">
      <div v-if="isVerdict" class="flex flex-wrap gap-2">
        <UButton
          v-for="v in verdictOptions" :key="v.value"
          :color="v.value === 'reject' ? 'error' : 'primary'"
          :variant="recommendation ? (v.value === recommendation ? 'solid' : 'outline') : (v.value === 'merge' ? 'solid' : 'outline')"
          :loading="submitting"
          @click="$emit('resolve', { verdict: v.value })"
        >
          {{ v.label }} <span v-if="v.value === recommendation" class="opacity-70">(Empfehlung)</span>
        </UButton>
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <UButton
          v-for="option in options" :key="option"
          :color="option === recommendation ? 'primary' : 'neutral'"
          :variant="option === recommendation ? 'solid' : 'outline'"
          :loading="submitting"
          @click="$emit('resolve', { choice: option })"
        >
          {{ option }} <span v-if="option === recommendation" class="opacity-70">(Empfehlung)</span>
        </UButton>
      </div>
    </template>

    <div v-if="resolution" class="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
      <p class="text-sm text-emerald-300">
        Entschieden: <strong>{{ resolution.payload.decision ?? resolution.payload.verdict }}</strong>
      </p>
      <p class="text-xs text-zinc-400 mt-1">
        {{ resolution.actor }} · Event {{ resolution.id }}
      </p>
    </div>
  </div>
</template>
