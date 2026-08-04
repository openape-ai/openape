<script setup lang="ts">
import { ref } from 'vue'
import { useOrgCrud } from '../../composables/useOrgCrud'

// Webhooks panel: event triggers. An external system POSTs to the hook URL and the
// Operator runs `prompt` (optionally with the payload) on the same spine as the
// time triggers → cockpit chat + Web-Push.
const props = defineProps<{ orgId: string }>()

const { t } = useI18n()
const { fmtDate } = useDateFormat()

interface Hook {
  id: string
  label: string
  token: string
  secret: string | null
  prompt: string
  eventFilter: string
  includePayload: boolean
  enabled: boolean
  createdBy: string
  lastFiredAt: number | null
}

interface HookForm { label: string, prompt: string, eventFilter: string, includePayload: boolean, useSecret: boolean }

const { items, loading, error, busy, showForm, saving, formError, form, openAdd, submit, patch, remove } = useOrgCrud<Hook, HookForm>({
  collection: () => `/api/cockpit/orgs/${props.orgId}/hooks`,
  emptyForm: () => ({ label: '', prompt: '', eventFilter: '', includePayload: false, useSecret: false }),
})

const origin = ref('')

const hookUrl = (token: string) => `${origin.value}/api/hooks/${token}`
// The API keeps this timestamp in milliseconds; the shared formatter takes seconds.
const fmt = (ms: number) => fmtDate(ms / 1000)
const copied = ref('')
async function copy(text: string, tag: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = tag
    setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500)
  }
  catch { /* clipboard blocked — the field is selectable anyway */ }
}

const created = ref<{ url: string, secret: string | null } | null>(null)

function startAdd() {
  created.value = null
  openAdd()
}

// The form stays open after saving: the URL (and with it the one-time HMAC secret)
// is only ever shown here.
async function save() {
  if (!form.prompt.trim()) {
    formError.value = t('common.required', { field: t('companyPanels.field.instruction') })
    return
  }
  const hook = await submit<{ token: string, secret: string | null }>({ ...form }, { closeForm: false })
  if (hook) created.value = { url: hookUrl(hook.token), secret: hook.secret }
}

if (import.meta.client) origin.value = window.location.origin
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        {{ t('companyPanels.webhooks.intro') }}
      </p>
      <UButton color="primary" variant="soft" icon="i-lucide-webhook" @click="startAdd">
        {{ t('companyPanels.webhooks.addButton') }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-6 text-center">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-6 text-center">
      {{ t('companyPanels.webhooks.empty') }}
    </div>
    <div v-else class="space-y-2">
      <div v-for="h in items" :key="h.id" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ h.label || t('common.unnamed') }}</span>
              <UBadge v-if="h.createdBy === 'operator'" color="info" variant="subtle" size="xs" icon="i-lucide-bot">
                {{ t('companyPanels.badge.fromOperator') }}
              </UBadge>
              <UBadge v-if="h.secret" color="primary" variant="subtle" size="xs" icon="i-lucide-shield-check">
                {{ t('companyPanels.webhooks.badge.hmac') }}
              </UBadge>
              <UBadge v-if="h.eventFilter" color="neutral" variant="subtle" size="xs" icon="i-lucide-filter">
                {{ h.eventFilter }}
              </UBadge>
              <UBadge v-if="h.includePayload" color="neutral" variant="subtle" size="xs">
                {{ t('companyPanels.webhooks.badge.payload') }}
              </UBadge>
              <UBadge v-if="!h.enabled" color="warning" variant="subtle" size="xs">
                {{ t('common.badge.paused') }}
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ h.prompt }}
            </p>
            <div class="flex items-center gap-2 mt-2">
              <code class="text-[11px] text-zinc-500 bg-zinc-950 rounded px-2 py-1 truncate max-w-md">{{ hookUrl(h.token) }}</code>
              <UButton
                color="neutral" variant="ghost" size="xs"
                :icon="copied === h.id ? 'i-lucide-check' : 'i-lucide-copy'"
                :aria-label="t('companyPanels.webhooks.copyUrlAria')"
                @click="copy(hookUrl(h.token), h.id)"
              />
            </div>
            <p class="text-[11px] text-zinc-600 mt-1">
              {{ t('common.lastFired') }} {{ h.lastFiredAt ? fmt(h.lastFiredAt) : t('time.never') }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <USwitch :model-value="h.enabled" :disabled="busy[h.id]" @update:model-value="patch(h.id, { enabled: !h.enabled })" />
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :aria-label="t('common.remove')" :loading="busy[h.id]" @click="remove(h.id)" />
          </div>
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ t('companyPanels.webhooks.form.title') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('common.close')" @click="showForm = false" />
          </div>

          <template v-if="!created">
            <UFormField :label="t('companyPanels.field.name')" :description="t('common.field.shortIdHint')">
              <UInput v-model="form.label" :placeholder="t('companyPanels.webhooks.field.name.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
            <UFormField :label="t('common.field.promptLabel')" :description="t('companyPanels.webhooks.field.prompt.description')">
              <UTextarea v-model="form.prompt" :rows="6" :placeholder="t('companyPanels.webhooks.field.prompt.placeholder')" class="w-full text-xs" :ui="{ base: 'w-full' }" />
            </UFormField>
            <UFormField :label="t('companyPanels.webhooks.field.eventFilter.label')" :description="t('companyPanels.webhooks.field.eventFilter.description')">
              <UInput v-model="form.eventFilter" :placeholder="t('companyPanels.webhooks.field.eventFilter.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <UCheckbox v-model="form.includePayload" />
              {{ t('companyPanels.webhooks.field.includePayload') }}
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <UCheckbox v-model="form.useSecret" />
              {{ t('companyPanels.webhooks.field.useSecret') }}
            </label>
            <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
            <div class="flex justify-end gap-2 pt-2">
              <UButton color="neutral" variant="ghost" @click="showForm = false">
                {{ t('common.cancel') }}
              </UButton>
              <UButton color="primary" :loading="saving" @click="save">
                {{ t('companyPanels.webhooks.createButton') }}
              </UButton>
            </div>
          </template>

          <template v-else>
            <UAlert color="success" variant="subtle" :title="t('companyPanels.webhooks.created.title')" :description="t('companyPanels.webhooks.created.description')" />
            <UFormField :label="t('companyPanels.webhooks.created.urlLabel')">
              <div class="flex items-center gap-2">
                <UInput :model-value="created.url" readonly class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
                <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-copy" :aria-label="t('companyPanels.webhooks.copyUrlAria')" @click="copy(created.url, 'new-url')" />
              </div>
            </UFormField>
            <UFormField v-if="created.secret" :label="t('companyPanels.webhooks.created.secretLabel')" :description="t('companyPanels.webhooks.created.secretDescription')">
              <div class="flex items-center gap-2">
                <UInput :model-value="created.secret" readonly class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
                <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-copy" :aria-label="t('companyPanels.webhooks.copySecretAria')" @click="copy(created.secret, 'new-secret')" />
              </div>
            </UFormField>
            <div class="flex justify-end pt-2">
              <UButton color="primary" @click="showForm = false">
                {{ t('common.done') }}
              </UButton>
            </div>
          </template>
        </div>
      </template>
    </UModal>
  </div>
</template>
