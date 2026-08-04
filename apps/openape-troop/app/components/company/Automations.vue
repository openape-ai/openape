<script setup lang="ts">
import { computed } from 'vue'
import { useOrgCrud } from '../../composables/useOrgCrud'

// Automations panel: proactive triggers. Each row is a schedule (cron daily /
// periodic, or a one-shot timer) whose `prompt` the Operator runs when due —
// the answer lands in the cockpit chat and fires a Web-Push.
const props = defineProps<{ orgId: string }>()

const { t } = useI18n()
const { fmtDate } = useDateFormat()

interface Trigger {
  id: string
  kind: string
  prompt: string
  atHour: number | null
  everyMinutes: number | null
  fireAt: number | null
  cronExpr: string | null
  enabled: boolean
  createdBy: string
  lastRunAt: number | null
}

// The API keeps these timestamps in milliseconds; the shared formatter takes seconds.
const fmt = (ms: number) => fmtDate(ms / 1000)

function scheduleLabel(trigger: Trigger): string {
  if (trigger.cronExpr) return t('companyPanels.automations.schedule.cron', { expr: trigger.cronExpr })
  if (trigger.fireAt != null) return t('companyPanels.automations.schedule.once', { when: fmt(trigger.fireAt) })
  if (trigger.atHour != null) return t('companyPanels.automations.schedule.daily', { time: `${String(trigger.atHour).padStart(2, '0')}:00` })
  if (trigger.everyMinutes != null) return t('companyPanels.automations.schedule.everyMinutes', { minutes: trigger.everyMinutes })
  return '—'
}

type Mode = 'daily' | 'periodic' | 'timer' | 'cron'
const modeOptions = computed(() => [
  { value: 'daily', label: t('companyPanels.automations.mode.daily') },
  { value: 'periodic', label: t('companyPanels.automations.mode.periodic') },
  { value: 'timer', label: t('companyPanels.automations.mode.timer') },
  { value: 'cron', label: t('companyPanels.automations.mode.cron') },
])

interface TriggerForm { kind: string, prompt: string, mode: Mode, atHour: number, everyMinutes: number, fireAtLocal: string, cronExpr: string }

const { items, loading, error, busy, showForm, editingId, saving, formError, form, openAdd, openEdit, submit, patch, remove } = useOrgCrud<Trigger, TriggerForm>({
  collection: () => `/api/cockpit/orgs/${props.orgId}/schedules`,
  emptyForm: () => ({ kind: '', prompt: '', mode: 'daily', atHour: 7, everyMinutes: 60, fireAtLocal: '', cronExpr: '' }),
})

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function edit(trigger: Trigger) {
  const mode: Mode = trigger.cronExpr ? 'cron' : trigger.fireAt != null ? 'timer' : trigger.everyMinutes != null ? 'periodic' : 'daily'
  openEdit(trigger.id, {
    kind: trigger.kind,
    prompt: trigger.prompt,
    mode,
    atHour: trigger.atHour ?? 7,
    everyMinutes: trigger.everyMinutes ?? 60,
    fireAtLocal: trigger.fireAt != null ? toLocalInput(trigger.fireAt) : '',
    cronExpr: trigger.cronExpr ?? '',
  })
}

const required = (fieldKey: string) => t('common.required', { field: t(fieldKey) })

async function save() {
  if (!form.kind.trim()) { formError.value = required('companyPanels.field.name'); return }
  if (!form.prompt.trim()) { formError.value = required('companyPanels.field.instruction'); return }
  const body: Record<string, unknown> = { kind: form.kind.trim(), prompt: form.prompt.trim(), atHour: null, everyMinutes: null, fireAt: null, cronExpr: null }
  if (form.mode === 'daily') {
    body.atHour = Math.max(0, Math.min(23, Math.floor(form.atHour)))
  }
  else if (form.mode === 'periodic') {
    body.everyMinutes = Math.max(1, Math.floor(form.everyMinutes))
  }
  else if (form.mode === 'cron') {
    if (!form.cronExpr.trim()) { formError.value = required('companyPanels.field.cronExpr'); return }
    body.cronExpr = form.cronExpr.trim()
  }
  else {
    const ms = form.fireAtLocal ? new Date(form.fireAtLocal).getTime() : Number.NaN
    if (!Number.isFinite(ms)) { formError.value = required('companyPanels.field.fireAt'); return }
    body.fireAt = ms
  }
  await submit(body)
}

const timerPreview = computed(() => {
  if (form.mode !== 'timer' || !form.fireAtLocal) return ''
  const ms = new Date(form.fireAtLocal).getTime()
  return Number.isFinite(ms) ? fmt(ms) : ''
})
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        {{ t('companyPanels.automations.intro') }}
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        {{ t('companyPanels.automations.addButton') }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      {{ t('companyPanels.automations.empty') }}
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="trigger in items"
        :key="trigger.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
        @click="edit(trigger)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ trigger.kind || t('common.unnamed') }}</span>
              <UBadge color="neutral" variant="subtle" size="xs" icon="i-lucide-clock">
                {{ scheduleLabel(trigger) }}
              </UBadge>
              <UBadge v-if="trigger.createdBy === 'operator'" color="info" variant="subtle" size="xs" icon="i-lucide-bot">
                {{ t('companyPanels.badge.fromOperator') }}
              </UBadge>
              <UBadge v-if="!trigger.enabled" color="warning" variant="subtle" size="xs">
                {{ t('common.badge.paused') }}
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ trigger.prompt }}
            </p>
            <p class="text-[11px] text-zinc-600 mt-1">
              {{ t('common.lastFired') }} {{ trigger.lastRunAt ? fmt(trigger.lastRunAt) : t('time.never') }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <USwitch :model-value="trigger.enabled" :disabled="busy[trigger.id]" @update:model-value="patch(trigger.id, { enabled: !trigger.enabled })" />
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :aria-label="t('common.remove')" :loading="busy[trigger.id]" @click="remove(trigger.id)" />
          </div>
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? t('companyPanels.automations.form.titleEdit') : t('companyPanels.automations.form.titleNew') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('common.close')" @click="showForm = false" />
          </div>
          <UFormField :label="t('companyPanels.field.name')" :description="t('common.field.shortIdHint')">
            <UInput v-model="form.kind" :placeholder="t('companyPanels.automations.field.name.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('companyPanels.automations.field.schedule.label')">
            <div class="space-y-3">
              <USelect v-model="form.mode" :items="modeOptions" value-key="value" class="w-full" />
              <div v-if="form.mode === 'daily'" class="flex items-center gap-2">
                <UInput v-model.number="form.atHour" type="number" :min="0" :max="23" class="w-24" />
                <span class="text-sm text-zinc-500">{{ t('companyPanels.automations.hourSuffix') }}</span>
              </div>
              <div v-else-if="form.mode === 'periodic'" class="flex items-center gap-2">
                <UInput v-model.number="form.everyMinutes" type="number" :min="1" class="w-24" />
                <span class="text-sm text-zinc-500">{{ t('companyPanels.automations.minutesSuffix') }}</span>
              </div>
              <div v-else-if="form.mode === 'timer'">
                <UInput v-model="form.fireAtLocal" type="datetime-local" class="w-full" :ui="{ base: 'w-full' }" />
                <p v-if="timerPreview" class="text-xs text-zinc-500 mt-1">
                  {{ t('companyPanels.automations.timerPreview', { when: timerPreview }) }}
                </p>
              </div>
              <div v-else>
                <UInput v-model="form.cronExpr" placeholder="0 7 * * 1-5" class="w-full font-mono" :ui="{ base: 'w-full' }" />
                <i18n-t keypath="companyPanels.automations.cronHelp" tag="p" class="text-xs text-zinc-500 mt-1">
                  <template #example>
                    <code>0 7 * * 1-5</code>
                  </template>
                </i18n-t>
              </div>
            </div>
          </UFormField>
          <UFormField :label="t('common.field.promptLabel')" :description="t('companyPanels.automations.field.prompt.description')">
            <UTextarea v-model="form.prompt" :rows="8" :placeholder="t('companyPanels.automations.field.prompt.placeholder')" class="w-full text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="saving" @click="save">
              {{ editingId ? t('common.save') : t('common.add') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <div class="mt-10 border-t border-zinc-800 pt-8">
      <CompanyWebhooks :org-id="props.orgId" />
    </div>
  </div>
</template>
