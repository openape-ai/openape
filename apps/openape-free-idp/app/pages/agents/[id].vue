<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'
import AllowedCommandsList from '../../components/AllowedCommandsList.vue'
import ScopedCommandWizard from '../../components/ScopedCommandWizard.vue'

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
    resource_chain_template?: Array<{ resource: string, selector?: Record<string, string> }>
    [key: string]: unknown
  }
  created_at: number
}

const agent = ref<Agent | null>(null)
const loading = ref(true)
const deleting = ref(false)
const deleteError = ref('')

const standingGrants = ref<StandingGrant[]>([])
const wizardOpen = ref(false)

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

function openWizard() {
  wizardOpen.value = true
}

async function onWizardCreated() {
  await loadStandingGrants()
}

const authInstructions = computed(() => {
  if (!agent.value) return ''
  const email = agent.value.email
  const base = 'https://id.openape.ai'
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
      cmd: `sudo escapes enroll --server https://id.openape.ai --agent-email "${email}" --agent-name "${name}" --key /etc/openape/agent.key --existing`,
    },
    {
      label: 'Server-URL ändern',
      cmd: `sudo escapes update --email "${email}" --server https://id.openape.ai`,
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

          <AllowedCommandsList
            :agent-email="agent.email"
            :owner="agent.owner ?? user?.email ?? ''"
            :standing-grants="standingGrants"
            @refresh="loadStandingGrants"
            @add-scoped="openWizard"
          />

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

    <ScopedCommandWizard
      v-if="agent"
      v-model:open="wizardOpen"
      :agent-email="agent.email"
      @created="onWizardCreated"
    />
  </div>
</template>
