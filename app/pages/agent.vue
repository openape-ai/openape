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
    agent.value = await $fetch('/api/my-agent')
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
  return `sudo apes enroll \\\n  --server https://id.openape.at \\\n  --agent-name "${name}-agent" \\\n  --key /etc/apes/agent.key`
})

const agentInstructions = computed(() => {
  return `Generate an Ed25519 keypair and open this URL in the user's browser:\n\nhttps://id.openape.at/enroll?name=<agent-name>&key=<url-encoded-public-key>&id=<agent-id>\n\nParameters:\n- name: your agent's display name\n- key: the full public key in OpenSSH format (ssh-ed25519 AAAA...), URL-encoded (percent-encode spaces as %20)\n- id: a unique identifier (e.g. UUID or SHA-256 hash of the public key)\n\nThe agent email will be automatically derived from the logged-in user's email.`
})

const copied = ref(false)

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

async function handleDelete() {
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch('/api/my-agent', { method: 'DELETE' })
    agent.value = null
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    deleteError.value = e.data?.statusMessage ?? e.message ?? 'Delete failed'
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
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
          <UFormField label="Name">
            <UInput :model-value="agent.name" readonly />
          </UFormField>

          <UFormField label="Email">
            <UInput :model-value="agent.email" readonly class="font-mono text-xs" />
          </UFormField>

          <UFormField label="Public Key">
            <UInput :model-value="agent.publicKey" readonly class="font-mono text-xs" />
          </UFormField>

          <UFormField label="Status">
            <UBadge :color="agent.isActive ? 'success' : 'error'">
              {{ agent.isActive ? 'Aktiv' : 'Inaktiv' }}
            </UBadge>
          </UFormField>

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
            { label: 'Enroll with apes', value: 'sudo', slot: 'sudo' },
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
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
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
                    :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
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
