<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  disabled?: boolean
}>()

const model = defineModel<string>({ default: '*/5 * * * *' })

// Tiny cron preview — only handles the subset we accept server-side
// (`*` / `N` / `*/N` per field). Returns the next ~5 fire times in
// human-readable form so the user can sanity-check their expression
// without running a full cron-parser dep. Falls back to "invalid"
// silently — server-side validation gives the actual error message.

type Field = { kind: 'every', step?: number } | { kind: 'fixed', value: number }

function parseField(token: string, max: number): Field | null {
  if (token === '*') return { kind: 'every' }
  if (token.startsWith('*/')) {
    const n = Number(token.slice(2))
    if (!Number.isInteger(n) || n < 1 || n > max) return null
    return { kind: 'every', step: n }
  }
  const n = Number(token)
  if (!Number.isInteger(n)) return null
  return { kind: 'fixed', value: n }
}

function fieldMatches(f: Field, value: number): boolean {
  if (f.kind === 'fixed') return value === f.value
  if (f.step) return value % f.step === 0
  return true
}

const preview = computed(() => {
  const parts = model.value.trim().split(/\s+/)
  if (parts.length !== 5) return { ok: false as const, msg: 'expected 5 space-separated fields' }
  const [m, h, dom, mo, dow] = parts as [string, string, string, string, string]
  const minute = parseField(m, 59)
  const hour = parseField(h, 23)
  const monthDay = parseField(dom, 31)
  const month = parseField(mo, 12)
  const weekDay = parseField(dow, 7)
  if (!minute || !hour || !monthDay || !month || !weekDay) {
    return { ok: false as const, msg: 'invalid field — see help' }
  }

  const now = new Date()
  const matches: string[] = []
  // Walk minute-by-minute up to 7 days forward; for our subset that's
  // overkill but cheap (10080 iterations max) and avoids handling
  // subtle calendar edge cases.
  const cursor = new Date(now)
  cursor.setSeconds(0, 0)
  for (let i = 0; i < 60 * 24 * 7 && matches.length < 5; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1)
    const min = cursor.getMinutes()
    const hr = cursor.getHours()
    const md = cursor.getDate()
    const mn = cursor.getMonth() + 1
    const wd = cursor.getDay() // 0–6
    if (fieldMatches(minute, min)
      && fieldMatches(hour, hr)
      && fieldMatches(monthDay, md)
      && fieldMatches(month, mn)
      && (fieldMatches(weekDay, wd) || (weekDay.kind === 'fixed' && weekDay.value === 7 && wd === 0))
    ) {
      matches.push(cursor.toLocaleString('de-AT', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }))
    }
  }

  if (matches.length === 0) {
    return { ok: true as const, msg: 'no fire times in the next 7 days' }
  }
  return { ok: true as const, msg: matches.join(' · ') }
})
</script>

<template>
  <div class="space-y-2">
    <UInput
      v-model="model"
      placeholder="*/5 * * * *"
      :disabled="disabled"
      class="font-mono"
    />
    <p
      class="text-xs"
      :class="preview.ok ? 'text-muted' : 'text-error'"
    >
      <UIcon v-if="preview.ok" name="i-lucide-clock" class="inline" />
      <UIcon v-else name="i-lucide-alert-triangle" class="inline" />
      {{ preview.msg }}
    </p>
    <p class="text-xs text-muted">
      Subset: <code>*</code>, <code>N</code> (fixed), <code>*/N</code> (only on minute + hour). 5 fields:
      minute hour day-of-month month day-of-week.
    </p>
  </div>
</template>
