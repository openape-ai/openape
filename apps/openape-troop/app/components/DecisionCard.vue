<script setup lang="ts">
import type { WireEvent } from '../utils/attention-inbox'
import { computed, ref, watch } from 'vue'
import { callKind, waitingLabel } from '../utils/attention-inbox'

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
const emit = defineEmits<{ resolve: [{ choice?: string, verdict?: string }] }>()

const e = computed(() => props.event)
const kind = computed(() => callKind(e.value))
const isVerdict = computed(() => kind.value === 'verdict')
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
const VERDICT_LABELS: Record<string, string> = { merge: 'Merge', rework: 'Nacharbeit', reject: 'Ablehnen' }
const VERDICT_VALUES = ['merge', 'rework', 'reject']

/** One list for both card kinds: value, its label, and what choosing it means. */
const choices = computed(() => {
  const values = isVerdict.value ? VERDICT_VALUES : options.value
  return values.map(value => ({
    value,
    label: isVerdict.value ? (VERDICT_LABELS[value] ?? value) : value,
    summary: optionSummaries.value[value],
    recommended: value === recommendation.value,
  }))
})

// Pre-select the recommendation so confirming is one tap; falling back to the
// first choice keeps the button meaningful on cards that recommend nothing.
const selected = ref('')
watch(choices, (list) => {
  if (list.some(c => c.value === selected.value)) return
  selected.value = list.find(c => c.recommended)?.value ?? list[0]?.value ?? ''
}, { immediate: true })

function confirm() {
  if (!selected.value) return
  emit('resolve', isVerdict.value ? { verdict: selected.value } : { choice: selected.value })
}
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

    <div
      v-if="choices.length" role="radiogroup" :aria-label="isVerdict ? 'Verdict wählen' : 'Option wählen'"
      class="space-y-2 mb-4"
    >
      <button
        v-for="choice in choices" :key="choice.value"
        type="button" role="radio" :aria-checked="choice.value === selected"
        :disabled="!!resolution || submitting"
        class="option-choice w-full text-left rounded-lg border px-3 py-2 transition-colors disabled:cursor-default"
        :class="choice.value === selected ? 'border-primary-500 bg-primary-500/10' : 'border-zinc-800 enabled:hover:border-zinc-600'"
        @click="selected = choice.value"
      >
        <span class="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden="true"
            class="size-4 shrink-0 rounded-full border grid place-items-center"
            :class="choice.value === selected ? 'border-primary-400' : 'border-zinc-600'"
          >
            <span v-if="choice.value === selected" class="size-2 rounded-full bg-primary-400" />
          </span>
          {{ choice.label }}
          <span v-if="choice.recommended" class="text-[10px] uppercase tracking-wide text-primary-400">Empfehlung</span>
        </span>
        <span v-if="choice.summary" class="block text-xs text-zinc-400 mt-1 leading-relaxed">
          {{ choice.summary }}
        </span>
      </button>
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
      <UButton
        data-test="confirm"
        :color="selected === 'reject' ? 'error' : 'primary'"
        :loading="submitting"
        :disabled="!selected"
        @click="confirm"
      >
        {{ isVerdict ? 'Verdict abgeben' : 'Entscheiden' }}: {{ choices.find(c => c.value === selected)?.label }}
      </UButton>
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
