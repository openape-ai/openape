<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

// Webhooks panel: event triggers. An external system POSTs to the hook URL and the
// Operator runs `prompt` (optionally with the payload) on the same spine as the
// time triggers → cockpit chat + Web-Push.
const props = defineProps<{ orgId: string }>()

interface Hook {
  id: string
  label: string
  token: string
  secret: string | null
  prompt: string
  includePayload: boolean
  enabled: boolean
  createdBy: string
  lastFiredAt: number | null
}

const items = ref<Hook[]>([])
const loading = ref(true)
const busy = reactive<Record<string, boolean>>({})
const origin = ref('')

const hookUrl = (token: string) => `${origin.value}/api/hooks/${token}`
const fmt = (ms: number) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })
const copied = ref('')
async function copy(text: string, tag: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = tag
    setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500)
  }
  catch { /* clipboard blocked — the field is selectable anyway */ }
}

async function load() {
  loading.value = true
  items.value = await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/hooks`)
  loading.value = false
}

const showForm = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ label: '', prompt: '', includePayload: false, useSecret: false })
const created = ref<{ url: string, secret: string | null } | null>(null)

function openAdd() {
  Object.assign(form, { label: '', prompt: '', includePayload: false, useSecret: false })
  formError.value = ''
  created.value = null
  showForm.value = true
}

async function submit() {
  if (!form.prompt.trim()) { formError.value = 'Anweisung nötig.'; return }
  saving.value = true
  formError.value = ''
  try {
    const res = await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/hooks`, { method: 'POST', body: { ...form } })
    created.value = { url: hookUrl(res.token), secret: res.secret }
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function toggleEnabled(h: Hook) {
  busy[h.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/hooks/${h.id}`, { method: 'PATCH', body: { enabled: !h.enabled } })
    await load()
  }
  finally { busy[h.id] = false }
}
async function remove(h: Hook) {
  busy[h.id] = true
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${props.orgId}/hooks/${h.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[h.id] = false }
}

watch(() => props.orgId, load, { immediate: true })
if (import.meta.client) origin.value = window.location.origin
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        Webhooks — ein externes Ereignis (POST auf die Hook-URL) lässt den Operator sich melden.
      </p>
      <UButton color="primary" variant="soft" icon="i-lucide-webhook" @click="openAdd">
        Webhook
      </UButton>
    </div>

    <div v-if="loading" class="text-zinc-500 py-6 text-center">
      Lädt …
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-6 text-center">
      Noch kein Webhook. Leg einen an — z. B. „CI failed: melde den fehlgeschlagenen Build".
    </div>
    <div v-else class="space-y-2">
      <div v-for="h in items" :key="h.id" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ h.label || '(ohne Name)' }}</span>
              <UBadge v-if="h.createdBy === 'operator'" color="info" variant="subtle" size="xs" icon="i-lucide-bot">
                vom Operator
              </UBadge>
              <UBadge v-if="h.secret" color="primary" variant="subtle" size="xs" icon="i-lucide-shield-check">
                HMAC
              </UBadge>
              <UBadge v-if="h.includePayload" color="neutral" variant="subtle" size="xs">
                Payload
              </UBadge>
              <UBadge v-if="!h.enabled" color="warning" variant="subtle" size="xs">
                pausiert
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
                @click="copy(hookUrl(h.token), h.id)"
              />
            </div>
            <p class="text-[11px] text-zinc-600 mt-1">
              zuletzt gefeuert: {{ h.lastFiredAt ? fmt(h.lastFiredAt) : 'noch nie' }}
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <USwitch :model-value="h.enabled" :disabled="busy[h.id]" @update:model-value="toggleEnabled(h)" />
            <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[h.id]" @click="remove(h)" />
          </div>
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              Webhook hinzufügen
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>

          <template v-if="!created">
            <UFormField label="Name" description="Kurzer Bezeichner.">
              <UInput v-model="form.label" placeholder="ci-failed" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
            <UFormField label="Anweisung (prompt)" description="Was der Operator tut, wenn das Ereignis eintrifft.">
              <UTextarea v-model="form.prompt" :rows="6" placeholder="Ein CI-Build ist fehlgeschlagen — melde welcher und was zu tun ist." class="w-full text-xs" :ui="{ base: 'w-full' }" />
            </UFormField>
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <UCheckbox v-model="form.includePayload" />
              Payload an den Operator übergeben (als Daten)
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <UCheckbox v-model="form.useSecret" />
              HMAC-Secret erzeugen (Signatur des Bodys prüfen)
            </label>
            <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
            <div class="flex justify-end gap-2 pt-2">
              <UButton color="neutral" variant="ghost" @click="showForm = false">
                Abbrechen
              </UButton>
              <UButton color="primary" :loading="saving" @click="submit">
                Erzeugen
              </UButton>
            </div>
          </template>

          <template v-else>
            <UAlert color="success" variant="subtle" title="Webhook erstellt" description="URL jetzt kopieren — beim HMAC-Secret ist dies die einzige Anzeige." />
            <UFormField label="Hook-URL">
              <div class="flex items-center gap-2">
                <UInput :model-value="created.url" readonly class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
                <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-copy" @click="copy(created.url, 'new-url')" />
              </div>
            </UFormField>
            <UFormField v-if="created.secret" label="HMAC-Secret" description="X-Signature: sha256=HMAC-SHA256(secret, body)">
              <div class="flex items-center gap-2">
                <UInput :model-value="created.secret" readonly class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
                <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-copy" @click="copy(created.secret, 'new-secret')" />
              </div>
            </UFormField>
            <div class="flex justify-end pt-2">
              <UButton color="primary" @click="showForm = false">
                Fertig
              </UButton>
            </div>
          </template>
        </div>
      </template>
    </UModal>
  </div>
</template>
