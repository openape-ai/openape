<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'
import { isSafeCommandGrant, SAFE_COMMAND_DEFAULTS } from '../../utils/safe-commands'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()

interface Agent {
  email: string
  name: string
  publicKey: string
  owner?: string
  approver?: string
  isActive: boolean
  createdAt: number
}

interface StandingGrant {
  id: string
  status: string
  type: string
  request: {
    reason?: string
    cli_id?: string
    action?: string
    delegate?: string
    [key: string]: unknown
  }
  created_at: number
}

const agent = ref<Agent | null>(null)
const loading = ref(true)
const deleting = ref(false)
const deleteError = ref('')

const standingGrants = ref<StandingGrant[]>([])
const safeCommandsBusy = ref<string | null>(null)
const customInput = ref('')
const safeCommandError = ref('')

useSeoMeta({ title: computed(() => agent.value ? `Agent: ${agent.value.name}` : 'Agent') })

await fetchUser()

async function loadAgent() {
  loading.value = true
  try {
    agent.value = await ($fetch as any)(`/api/my-agents/${encodeURIComponent(String(route.params.id))}`)
  }
  catch {
    agent.value = null
  }
  finally {
    loading.value = false
  }
}

async function loadStandingGrants() {
  if (!agent.value) return
  try {
    const all = await ($fetch as any)('/api/standing-grants') as StandingGrant[]
    standingGrants.value = all.filter(g => g.request?.delegate === agent.value!.email && g.status === 'approved')
  }
  catch {
    standingGrants.value = []
  }
}

async function loadAll() {
  await loadAgent()
  await loadStandingGrants()
}

watch(user, (u) => {
  if (u) loadAll()
}, { immediate: true })

// Safe-command helpers
const safeCommandByCliId = computed(() => {
  const map = new Map<string, StandingGrant>()
  for (const g of standingGrants.value) {
    if (!isSafeCommandGrant(g)) continue
    const cliId = g.request?.cli_id
    if (typeof cliId === 'string') map.set(cliId, g)
  }
  return map
})
const customSafeCommands = computed(() =>
  standingGrants.value.filter(g => g.request?.reason === 'safe-command:custom'),
)
const scopedStandingGrants = computed(() =>
  standingGrants.value.filter(g => !isSafeCommandGrant(g)),
)

async function toggleSafeCommand(cliId: string, action: 'exec' | 'read') {
  if (!agent.value) return
  safeCommandError.value = ''
  safeCommandsBusy.value = cliId
  try {
    const existing = safeCommandByCliId.value.get(cliId)
    if (existing) {
      await $fetch(`/api/standing-grants/${encodeURIComponent(existing.id)}`, { method: 'DELETE' })
    }
    else {
      await $fetch('/api/standing-grants', {
        method: 'POST',
        body: {
          delegate: agent.value.email,
          audience: 'shapes',
          target_host: '*',
          cli_id: cliId,
          resource_chain_template: [],
          action,
          max_risk: 'low',
          grant_type: 'always',
          reason: 'safe-command:default',
        },
      })
    }
    await loadStandingGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string } }
    safeCommandError.value = e.data?.detail ?? e.data?.title ?? `Toggle ${cliId} failed`
  }
  finally {
    safeCommandsBusy.value = null
  }
}

async function addCustomSafeCommand() {
  if (!agent.value) return
  const cliId = customInput.value.trim()
  if (!cliId) return
  safeCommandError.value = ''
  safeCommandsBusy.value = cliId
  try {
    await $fetch('/api/standing-grants', {
      method: 'POST',
      body: {
        delegate: agent.value.email,
        audience: 'shapes',
        target_host: '*',
        cli_id: cliId,
        resource_chain_template: [],
        action: 'exec',
        max_risk: 'low',
        grant_type: 'always',
        reason: 'safe-command:custom',
      },
    })
    customInput.value = ''
    await loadStandingGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string } }
    safeCommandError.value = e.data?.detail ?? e.data?.title ?? `Add ${cliId} failed`
  }
  finally {
    safeCommandsBusy.value = null
  }
}

async function removeCustomSafeCommand(grant: StandingGrant) {
  safeCommandError.value = ''
  const cliId = grant.request?.cli_id || grant.id
  safeCommandsBusy.value = cliId
  try {
    await $fetch(`/api/standing-grants/${encodeURIComponent(grant.id)}`, { method: 'DELETE' })
    await loadStandingGrants()
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string } }
    safeCommandError.value = e.data?.detail ?? e.data?.title ?? 'Remove failed'
  }
  finally {
    safeCommandsBusy.value = null
  }
}

const authInstructions = computed(() => {
  if (!agent.value) return ''
  const email = agent.value.email
  const base = 'https://id.openape.at'
  return `You can authenticate at ${base} using Ed25519 challenge-response:

Agent email: ${email}

1. POST ${base}/api/agent/challenge
   Body: { "agent_id": "${email}" }
   Response: { "challenge": "<hex-string>" }

2. Sign the challenge (UTF-8 bytes) with your Ed25519 private key.
   Encode the signature as base64.

3. POST ${base}/api/agent/authenticate
   Body: { "agent_id": "${email}", "challenge": "<from-step-1>", "signature": "<base64>" }
   Response: { "token": "<jwt>", "expires_in": 3600 }

Use the token as: Authorization: Bearer <token>`
})

const escapesCommands = computed(() => {
  if (!agent.value) return []
  const email = agent.value.email
  const name = agent.value.name
  return [
    {
      label: 'Enroll (neuer Server)',
      cmd: `sudo escapes enroll --server https://id.openape.at --agent-email "${email}" --agent-name "${name}" --key /etc/openape/agent.key --existing`,
    },
    {
      label: 'Server-URL ändern',
      cmd: `sudo escapes update --email "${email}" --server https://id.openape.at`,
    },
    {
      label: 'Agent entfernen (nur lokal)',
      cmd: `sudo escapes remove --email "${email}"`,
    },
    {
      label: 'Agent entfernen (lokal + remote)',
      cmd: `sudo escapes remove --email "${email}" --remote`,
    },
  ]
})

const editingKey = ref(false)
const editKeyValue = ref('')
const savingKey = ref(false)
const keyError = ref('')

function startEditKey() {
  editKeyValue.value = agent.value?.publicKey ?? ''
  keyError.value = ''
  editingKey.value = true
}

function cancelEditKey() {
  editingKey.value = false
  keyError.value = ''
}

async function saveKey() {
  if (!agent.value) return
  savingKey.value = true
  keyError.value = ''
  try {
    await $fetch(`/api/my-agents/${encodeURIComponent(agent.value.email)}`, { method: 'PATCH', body: { publicKey: editKeyValue.value } })
    await loadAgent()
    editingKey.value = false
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    keyError.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Update failed'
  }
  finally {
    savingKey.value = false
  }
}

const copied = ref('')

function copyField(field: string, text: string) {
  navigator.clipboard.writeText(text)
  copied.value = field
  setTimeout(() => copied.value = '', 2000)
}

async function handleDelete() {
  if (!agent.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`/api/my-agents/${encodeURIComponent(agent.value.email)}`, { method: 'DELETE' })
    await navigateTo('/agents')
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    deleteError.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Delete failed'
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-lg bg-gray-900 border border-gray-800">
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold text-white">
            Agent Details
          </h1>
          <UButton
            to="/agents"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            size="sm"
          />
        </div>
      </template>

      <div v-if="authLoading || loading" class="text-center text-gray-400">
        Loading...
      </div>

      <template v-else-if="!user">
        <p class="text-center text-gray-400 mb-4">
          Du musst angemeldet sein.
        </p>
        <UButton
          :to="`/login?returnTo=/agents/${route.params.id}`"
          color="primary"
          block
          label="Anmelden"
        />
      </template>

      <template v-else-if="!agent">
        <UAlert
          color="error"
          title="Agent nicht gefunden"
          description="Dieser Agent existiert nicht oder gehört nicht zu deinem Account."
        />
        <UButton
          to="/agents"
          color="primary"
          block
          class="mt-4"
          label="Zurück zur Übersicht"
        />
      </template>

      <template v-else>
        <div class="space-y-4">
          <div>
            <p class="text-sm text-gray-400 mb-1">
              Name
            </p>
            <div class="flex items-center gap-2">
              <pre class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 overflow-x-auto">{{ agent.name }}</pre>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="copied === 'name' ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyField('name', agent.name)"
              />
            </div>
          </div>

          <div>
            <p class="text-sm text-gray-400 mb-1">
              Email
            </p>
            <div class="flex items-center gap-2">
              <pre class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono overflow-x-auto">{{ agent.email }}</pre>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="copied === 'email' ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyField('email', agent.email)"
              />
            </div>
          </div>

          <div>
            <p class="text-sm text-gray-400 mb-1">
              Public Key
            </p>
            <template v-if="editingKey">
              <UTextarea
                v-model="editKeyValue"
                :rows="3"
                class="font-mono text-xs"
                placeholder="ssh-ed25519 AAAA..."
              />
              <UAlert
                v-if="keyError"
                color="error"
                :title="keyError"
                class="mt-2"
              />
              <div class="flex gap-2 mt-2">
                <UButton
                  color="primary"
                  size="sm"
                  :loading="savingKey"
                  icon="i-lucide-check"
                  label="Speichern"
                  @click="saveKey"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-x"
                  label="Abbrechen"
                  :disabled="savingKey"
                  @click="cancelEditKey"
                />
              </div>
            </template>
            <div v-else class="flex items-center gap-2">
              <pre class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono overflow-x-auto break-all whitespace-pre-wrap">{{ agent.publicKey }}</pre>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                @click="startEditKey"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="copied === 'key' ? 'i-lucide-check' : 'i-lucide-copy'"
                @click="copyField('key', agent.publicKey)"
              />
            </div>
          </div>

          <div>
            <p class="text-sm text-gray-400 mb-1">
              Status
            </p>
            <UBadge :color="agent.isActive ? 'success' : 'error'">
              {{ agent.isActive ? 'Aktiv' : 'Inaktiv' }}
            </UBadge>
          </div>

          <div>
            <p class="text-sm text-gray-400 mb-1">
              Authentication
            </p>
            <div class="relative">
              <pre class="bg-gray-800 border border-gray-700 rounded-lg p-3 pr-10 text-xs text-gray-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">{{ authInstructions }}</pre>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="copied === 'auth' ? 'i-lucide-check' : 'i-lucide-copy'"
                class="absolute top-2 right-2"
                @click="copyField('auth', authInstructions)"
              />
            </div>
          </div>

          <div v-if="escapesCommands.length">
            <p class="text-sm text-gray-400 mb-2">
              Server-Befehle (escapes)
            </p>
            <div class="space-y-2">
              <div
                v-for="item in escapesCommands"
                :key="item.label"
              >
                <p class="text-xs text-gray-500 mb-1">
                  {{ item.label }}
                </p>
                <div class="relative">
                  <pre class="bg-gray-800 border border-gray-700 rounded-lg p-3 pr-10 text-xs text-gray-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">{{ item.cmd }}</pre>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="copied === item.label ? 'i-lucide-check' : 'i-lucide-copy'"
                    class="absolute top-2 right-2"
                    @click="copyField(item.label, item.cmd)"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Safe Commands section -->
          <div>
            <p class="text-sm text-gray-400 mb-2">
              Safe Commands
            </p>
            <p class="text-xs text-gray-500 mb-3">
              Niedrigrisiko-CLIs, die ohne Rückfrage auto-approved werden.
            </p>

            <UAlert
              v-if="safeCommandError"
              color="error"
              :title="safeCommandError"
              class="mb-3"
              @close="safeCommandError = ''"
            />

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label
                v-for="def in SAFE_COMMAND_DEFAULTS"
                :key="def.cli_id"
                class="flex items-start gap-2 p-2 rounded-md border border-gray-700 bg-gray-800/50 hover:bg-gray-800 cursor-pointer"
                :title="def.description"
              >
                <UCheckbox
                  :model-value="safeCommandByCliId.has(def.cli_id)"
                  :disabled="safeCommandsBusy === def.cli_id"
                  @update:model-value="toggleSafeCommand(def.cli_id, def.action)"
                />
                <div class="text-xs min-w-0">
                  <div class="font-mono font-semibold text-gray-100">{{ def.cli_id }}</div>
                  <div class="text-gray-400 truncate">{{ def.display }}</div>
                </div>
              </label>
            </div>

            <div class="mt-3">
              <p class="text-xs text-gray-500 mb-2">
                Custom safe commands
              </p>
              <div v-if="customSafeCommands.length === 0" class="text-xs text-gray-500 mb-2">
                Keine. Füge eine beliebige CLI hinzu, um Low-Risk-Aufrufe zu auto-approven.
              </div>
              <div v-else class="flex flex-wrap gap-2 mb-2">
                <UBadge
                  v-for="g in customSafeCommands"
                  :key="g.id"
                  color="neutral"
                  variant="soft"
                  class="font-mono text-xs"
                >
                  {{ g.request?.cli_id }}
                  <UButton
                    variant="link"
                    size="xs"
                    color="error"
                    icon="i-lucide-x"
                    class="!p-0 ml-1"
                    :disabled="safeCommandsBusy === (g.request?.cli_id || g.id)"
                    @click="removeCustomSafeCommand(g)"
                  />
                </UBadge>
              </div>
              <div class="flex gap-2">
                <UInput
                  v-model="customInput"
                  placeholder="e.g. jq"
                  size="sm"
                  class="font-mono flex-1"
                  @keydown.enter="addCustomSafeCommand"
                />
                <UButton
                  size="sm"
                  :disabled="!customInput.trim() || safeCommandsBusy !== null"
                  icon="i-lucide-plus"
                  @click="addCustomSafeCommand"
                >
                  Add
                </UButton>
              </div>
            </div>
          </div>

          <!-- Scoped standing grants -->
          <div v-if="scopedStandingGrants.length > 0">
            <p class="text-sm text-gray-400 mb-2">
              Scoped Standing Grants
            </p>
            <div class="space-y-2">
              <div
                v-for="g in scopedStandingGrants"
                :key="g.id"
                class="flex items-center justify-between p-2 rounded-md border border-gray-700 bg-gray-800/50"
              >
                <div class="min-w-0 flex-1">
                  <code class="text-xs font-mono text-gray-200 break-all">
                    {{ g.request?.cli_id ?? '*' }} · {{ g.request?.action ?? 'any' }}
                  </code>
                  <div v-if="g.request?.reason" class="text-xs text-gray-500 mt-0.5">
                    {{ g.request.reason }}
                  </div>
                </div>
                <UButton
                  variant="ghost"
                  size="xs"
                  color="error"
                  icon="i-lucide-trash-2"
                  :disabled="safeCommandsBusy === g.id"
                  @click="removeCustomSafeCommand(g)"
                />
              </div>
            </div>
          </div>

          <UAlert
            v-if="deleteError"
            color="error"
            :title="deleteError"
          />

          <UButton
            color="error"
            variant="outline"
            block
            :loading="deleting"
            icon="i-lucide-trash-2"
            @click="handleDelete"
          >
            Agent löschen
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
