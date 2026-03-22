<script setup lang="ts">
useSeoMeta({ title: 'Agent verwalten' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()

const agent = ref<{ id: string, email: string, name: string, publicKey: string, owner: string, approver: string, isActive: boolean, createdAt: number } | null>(null)
const loading = ref(true)
const deleting = ref(false)
const deleteError = ref('')
const justEnrolled = computed(() => route.query.enrolled === 'true')

await fetchUser()

async function loadAgent() {
  loading.value = true
  try {
    agent.value = await ($fetch as any)('/api/my-agent') // eslint-disable-line ts/no-explicit-any -- Nuxt route type stack overflow
  }
  catch {
    agent.value = null
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => {
  if (u) loadAgent()
}, { immediate: true })

const sudoCommand = computed(() => {
  const email = user.value?.email ?? ''
  const name = email.split('@')[0] ?? 'agent'
  const [local, domain] = email.split('@')
  const agentEmail = `agent+${local}+${(domain ?? '').replace(/\./g, '_')}@id.openape.at`
  return `sudo escapes enroll \\\n  --server https://id.openape.at \\\n  --agent-email "${agentEmail}" \\\n  --agent-name "${name}-agent" \\\n  --key /etc/openape/agent.key`
})

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

const agentInstructions = computed(() => {
  return `Generate an Ed25519 keypair and open this URL in the user's browser:\n\nhttps://id.openape.at/enroll?name=<agent-name>&key=<url-encoded-public-key>\n\nParameters:\n- name: your agent's display name\n- key: the full public key in OpenSSH format (ssh-ed25519 AAAA...), URL-encoded (percent-encode spaces as %20)\n\nThe agent email will be automatically derived from the logged-in user's email.`
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
  savingKey.value = true
  keyError.value = ''
  try {
    await $fetch('/api/my-agent', { method: 'PATCH', body: { publicKey: editKeyValue.value } })
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

function copyText(text: string) {
  copyField('text', text)
}

async function handleDelete() {
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch('/api/my-agent', { method: 'DELETE' })
    agent.value = null
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
            Agent verwalten
          </h1>
          <UButton
            to="/"
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
          to="/login?returnTo=/agent"
          color="primary"
          block
          label="Anmelden"
        />
      </template>

      <template v-else-if="agent">
        <UAlert
          v-if="justEnrolled"
          color="success"
          title="Agent erfolgreich registriert!"
          class="mb-4"
        />

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

      <template v-else>
        <UTabs
          default-value="agent"
          :items="[
            { label: 'Enroll with agent', value: 'agent', slot: 'agent' },
            { label: 'Enroll with escapes', value: 'sudo', slot: 'sudo' },
          ]"
        >
          <template #agent>
            <div class="space-y-5 pt-4">
              <p class="text-sm text-gray-400">
                Paste the following instructions to your AI agent so it can generate an enrollment URL for you.
              </p>

              <div class="relative">
                <pre class="bg-gray-800 border border-gray-700 rounded-lg p-3 pr-10 text-xs text-gray-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">{{ agentInstructions }}</pre>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :icon="copied === 'text' ? 'i-lucide-check' : 'i-lucide-copy'"
                  class="absolute top-2 right-2"
                  @click="copyText(agentInstructions)"
                />
              </div>

              <p class="text-sm text-gray-400">
                Once the agent gives you the URL, open it in your browser and confirm the enrollment.
              </p>
            </div>
          </template>

          <template #sudo>
            <div class="space-y-5 pt-4">
              <p class="text-sm text-gray-400">
                Run this command on the machine where your agent should run.
              </p>

              <!-- Step 1 -->
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0">1</span>
                  <p class="text-sm text-gray-300">
                    Run this on the target machine:
                  </p>
                </div>
                <div class="relative">
                  <pre class="bg-gray-800 border border-gray-700 rounded-lg p-3 pr-10 text-xs text-gray-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">{{ sudoCommand }}</pre>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="copied === 'text' ? 'i-lucide-check' : 'i-lucide-copy'"
                    class="absolute top-2 right-2"
                    @click="copyText(sudoCommand.replace(/\\\n\s*/g, ''))"
                  />
                </div>
              </div>

              <!-- Step 2 -->
              <div class="flex items-start gap-2">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">2</span>
                <p class="text-sm text-gray-300">
                  Open the enrollment URL that the command outputs in your browser.
                </p>
              </div>

              <!-- Step 3 -->
              <div class="flex items-start gap-2">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">3</span>
                <p class="text-sm text-gray-300">
                  Confirm the enrollment. Your agent can then authenticate via challenge-response.
                </p>
              </div>
            </div>
          </template>
        </UTabs>
      </template>
    </UCard>
  </div>
</template>
