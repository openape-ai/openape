<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// One-step Agent Recipe deploy from the troop UI — the web equivalent
// of `apes agent deploy <repo>@<ref>` (Agent Recipe M3/M4). Posts to
// /api/agents/recipe-deploy, then (once the agent is online) binds the
// declared capability secrets via the M2c endpoint. Values are sealed
// server-side before they are stored — see the Agent Recipe docs.

const open = defineModel<boolean>('open', { default: false })

interface Schedule { task_id: string, cron: string, name: string }
interface DeployResponse {
  intent_id: string
  agent_name: string
  ref: string
  required_capabilities: string[]
  schedules: Schedule[]
}

const form = ref({ repo_ref: '', params: '' })
const submitting = ref(false)
const deployRes = ref<DeployResponse | null>(null)
const secretValues = ref<Record<string, string>>({})
const phase = ref<'form' | 'waiting' | 'binding' | 'done'>('form')
const error = ref('')
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null)

watch(open, (now) => {
  if (!now) return
  form.value = { repo_ref: '', params: '' }
  submitting.value = false
  deployRes.value = null
  secretValues.value = {}
  phase.value = 'form'
  error.value = ''
})

// `KEY=value` per line → { KEY: value }. Blank lines ignored.
function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`bad param line: "${line}" (expected KEY=value)`)
    out[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return out
}

const canSubmit = computed(() =>
  !submitting.value && phase.value === 'form' && /.+@.+/.test(form.value.repo_ref.trim()),
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = ''
  try {
    let params: Record<string, string>
    try { params = parseParams(form.value.params) }
    catch (e: any) { error.value = e.message; submitting.value = false; return }

    const res: DeployResponse = await ($fetch as any)('/api/agents/recipe-deploy', {
      method: 'POST',
      body: { repo_ref: form.value.repo_ref.trim(), params },
    })
    deployRes.value = res
    for (const env of res.required_capabilities) secretValues.value[env] = ''
    phase.value = 'waiting'
    pollResult()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'deploy failed'
  }
  finally {
    submitting.value = false
  }
}

async function pollResult() {
  const res = deployRes.value
  if (!res) return
  try {
    const st: any = await ($fetch as any)(`/api/agents/spawn-intent/${res.intent_id}`)
    if (st.pending) {
      pollTimer.value = setTimeout(pollResult, 2000)
      return
    }
    if (!st.ok) {
      error.value = st.error || 'spawn failed'
      phase.value = 'form'
      return
    }
    await bindSecrets()
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'poll failed'
  }
}

async function bindSecrets() {
  const res = deployRes.value
  if (!res) return
  phase.value = 'binding'
  for (const env of res.required_capabilities) {
    const value = secretValues.value[env]
    if (!value) { error.value = `no value entered for ${env}`; return }
    // The agent's first sync (pubkey) can lag the spawn-result by a
    // few seconds → retry on 404/409.
    let bound = false
    for (let i = 0; i < 40 && !bound; i++) {
      try {
        await ($fetch as any)(`/api/agents/${encodeURIComponent(res.agent_name)}/secrets/${encodeURIComponent(env)}`, {
          method: 'PUT',
          body: { value },
        })
        bound = true
      }
      catch (err: any) {
        if (i === 39) { error.value = `binding ${env} failed: ${err?.data?.statusMessage || err?.message}`; return }
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }
  phase.value = 'done'
}

function close() {
  if (pollTimer.value) clearTimeout(pollTimer.value)
  pollTimer.value = null
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md max-h-[90vh] flex flex-col' }">
    <template #content>
      <div class="p-5 space-y-4 overflow-y-auto">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              Deploy a recipe
            </h3>
            <p class="text-xs text-muted">
              One-step deploy of an Agent Recipe from a pinned repo. Secrets are sealed to the agent before they're stored.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="close" />
        </div>

        <UAlert v-if="error" color="error" :title="error" />

        <template v-if="phase === 'form'">
          <UFormField label="Recipe" description="Pinned repo ref — github.com/<owner>/<name>@<tag|commit>">
            <UInput v-model="form.repo_ref" placeholder="github.com/openape-official-ape-agents/bluesky-summary@v0.1.0" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Params" description="One KEY=value per line (recipe params, e.g. topic=AI agents)">
            <UTextarea v-model="form.params" :rows="3" autoresize placeholder="topic=AI agents" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
        </template>

        <template v-else-if="deployRes">
          <div class="rounded border border-default p-3 text-sm space-y-1">
            <div><span class="text-muted">Agent:</span> <code>{{ deployRes.agent_name }}</code> <span class="text-muted">@ {{ deployRes.ref }}</span></div>
            <div>
              <span class="text-muted">Schedules:</span>
              <code v-for="s in deployRes.schedules" :key="s.task_id" class="ml-1">{{ s.cron }}</code>
              <span v-if="deployRes.schedules.length === 0" class="text-muted">none</span>
            </div>
          </div>

          <UFormField
            v-for="env in deployRes.required_capabilities"
            :key="env"
            :label="env"
            description="Sealed to the agent's key before it is stored."
          >
            <UInput v-model="secretValues[env]" type="password" :disabled="phase === 'done'" placeholder="secret value" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>

          <div v-if="phase === 'waiting'" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
            <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
            <div>
              <div class="font-medium">
                Waiting for DDISA approval…
              </div>
              <div class="text-xs text-muted mt-1">
                Approve the spawn grant in the OpenApe app on your phone. Fill the secret values meanwhile — they're bound automatically once the agent is online.
              </div>
            </div>
          </div>
          <div v-else-if="phase === 'binding'" class="text-sm flex items-center gap-2">
            <UIcon name="i-lucide-loader-circle" class="animate-spin size-4" /> Binding secrets…
          </div>
          <UAlert v-else-if="phase === 'done'" color="success" :title="`${deployRes.agent_name} deployed`" description="Schedules are live; secrets are sealed to the agent." />
        </template>

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="close">
            {{ phase === 'done' ? 'Close' : 'Cancel' }}
          </UButton>
          <UButton v-if="phase === 'form'" color="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
            Deploy
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
