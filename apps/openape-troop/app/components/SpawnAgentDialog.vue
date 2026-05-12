<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface NestHost {
  host_id: string
  hostname: string
  version: string
  last_seen_at: number
}

const open = defineModel<boolean>('open', { default: false })

const hosts = ref<NestHost[]>([])
const hostsError = ref('')
const loadingHosts = ref(false)

async function loadHosts() {
  loadingHosts.value = true
  hostsError.value = ''
  try { hosts.value = await ($fetch as any)('/api/nest/hosts') }
  catch (err: any) {
    hostsError.value = err?.data?.statusMessage || err?.message || 'failed to load nest hosts'
  }
  finally {
    loadingHosts.value = false
  }
}

watch(open, (now) => { if (now) loadHosts() })

// Reset form whenever the dialog opens. We don't pre-fill from the
// previous spawn — names are unique per owner so reusing would
// guarantee a 409 anyway, and the bridge config is per-agent.
const form = ref({
  name: '',
  host_id: '',
  bridge_key: '',
  bridge_base_url: '',
  bridge_model: '',
})
const submitting = ref(false)
const intentId = ref('')
const result = ref<null | { ok: boolean, agent_email?: string, error?: string }>(null)
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null)

watch(open, (now) => {
  if (!now) return
  form.value = { name: '', host_id: '', bridge_key: '', bridge_base_url: '', bridge_model: '' }
  intentId.value = ''
  result.value = null
})

const canSubmit = computed(() =>
  !submitting.value
  && !intentId.value
  && form.value.name.length > 0
  && /^[a-z][a-z0-9-]{0,23}$/.test(form.value.name)
  && hosts.value.length > 0,
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body: Record<string, string> = { name: form.value.name }
    if (form.value.host_id) body.host_id = form.value.host_id
    if (form.value.bridge_key) body.bridge_key = form.value.bridge_key
    if (form.value.bridge_base_url) body.bridge_base_url = form.value.bridge_base_url
    if (form.value.bridge_model) body.bridge_model = form.value.bridge_model
    const res = await ($fetch as any)('/api/agents/spawn-intent', { method: 'POST', body })
    intentId.value = res.intent_id
    pollResult()
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.message || 'spawn failed' }
  }
  finally {
    submitting.value = false
  }
}

async function pollResult() {
  if (!intentId.value) return
  try {
    const res = await ($fetch as any)(`/api/agents/spawn-intent/${intentId.value}`)
    if (res.pending) {
      // Patrick is still on the approve-grant screen on his iPhone.
      // Re-check in 2s. The intent map auto-prunes after 30min so we
      // don't poll forever — but the UI dialog will close on dismiss.
      pollTimer.value = setTimeout(pollResult, 2000)
      return
    }
    result.value = { ok: res.ok, agent_email: res.agent_email, error: res.error }
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.message || 'poll failed' }
  }
}

function close() {
  if (pollTimer.value) clearTimeout(pollTimer.value)
  pollTimer.value = null
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-5 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              Spawn agent
            </h3>
            <p class="text-xs text-muted">
              Runs <code>apes agents spawn</code> on the selected Mac. You'll get a DDISA grant request on your iPhone — approve to complete.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="close" />
        </div>

        <UAlert v-if="hostsError" color="error" :title="hostsError" />
        <UAlert
          v-else-if="!loadingHosts && hosts.length === 0"
          color="warning"
          title="No connected nest"
          description="Start the nest daemon on a Mac (apes nest install + run) and refresh. The legacy `apes nest spawn` CLI path still works as a fallback."
        />

        <UFormField v-if="hosts.length > 1" label="Host" description="You have multiple Macs connected — pick the one to spawn on.">
          <USelect
            v-model="form.host_id"
            :items="hosts.map(h => ({ label: `${h.hostname} (${h.version})`, value: h.host_id }))"
            :disabled="!!intentId"
          />
        </UFormField>

        <UFormField label="Name" description="lowercase, [a-z0-9-], max 24 chars">
          <UInput v-model="form.name" placeholder="igor31" :disabled="!!intentId" />
        </UFormField>

        <details class="text-xs text-muted">
          <summary class="cursor-pointer select-none">
            Bridge overrides (optional)
          </summary>
          <div class="space-y-3 mt-3">
            <UFormField label="LITELLM_API_KEY" description="Defaults to ~/litellm/.env on the host.">
              <UInput v-model="form.bridge_key" type="password" placeholder="sk-… or token" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="LITELLM_BASE_URL" description="Defaults to http://127.0.0.1:4000/v1">
              <UInput v-model="form.bridge_base_url" placeholder="https://iurio.headwai.org/openai" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="APE_CHAT_BRIDGE_MODEL" description="Required by the bridge at runtime.">
              <UInput v-model="form.bridge_model" placeholder="gpt-5.4" :disabled="!!intentId" />
            </UFormField>
          </div>
        </details>

        <div v-if="intentId && !result" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
          <div>
            <div class="font-medium">
              Waiting for DDISA approval…
            </div>
            <div class="text-xs text-muted mt-1">
              Check your iPhone — Patrick approves the as=root grant in the OpenApe app. This dialog updates automatically when the spawn completes.
            </div>
          </div>
        </div>

        <UAlert v-if="result?.ok" color="success" :title="`Spawned: ${result.agent_email ?? form.name}`" />
        <UAlert v-if="result && !result.ok" color="error" title="Spawn failed" :description="result.error" />

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="close">
            {{ result?.ok ? 'Close' : 'Cancel' }}
          </UButton>
          <UButton
            v-if="!result?.ok"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submit"
          >
            Spawn
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
