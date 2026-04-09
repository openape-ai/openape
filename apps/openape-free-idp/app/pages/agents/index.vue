<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'

useSeoMeta({ title: 'Agents verwalten' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()

interface Agent {
  email: string
  name: string
  owner?: string
  approver?: string
  isActive: boolean
  createdAt: number
}

const agents = ref<Agent[]>([])
const loading = ref(true)
const justEnrolled = computed(() => route.query.enrolled === 'true')
const config = useRuntimeConfig()
const maxAgents = config.public.maxAgentsPerUser
const limitReached = computed(() => agents.value.length >= maxAgents)

await fetchUser()

async function loadAgents() {
  loading.value = true
  try {
    agents.value = await ($fetch as any)('/api/my-agents')
  }
  catch {
    agents.value = []
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => {
  if (u) loadAgents()
}, { immediate: true })

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const agentInstructions = computed(() => {
  return `Generate an Ed25519 keypair and open this URL in the user's browser:\n\nhttps://id.openape.at/enroll?name=<agent-name>&key=<url-encoded-public-key>\n\nParameters:\n- name: your agent's display name\n- key: the full public key in OpenSSH format (ssh-ed25519 AAAA...), URL-encoded (percent-encode spaces as %20)\n\nThe agent email will be automatically derived from the logged-in user's email.`
})

const sudoCommand = computed(() => {
  const email = user.value?.email ?? ''
  const name = email.split('@')[0] ?? 'agent'
  const [local, domain] = email.split('@')
  const agentEmail = `agent+${local}+${(domain ?? '').replace(/\./g, '_')}@id.openape.at`
  return `sudo escapes enroll \\\n  --server https://id.openape.at \\\n  --agent-email "${agentEmail}" \\\n  --agent-name "${name}-agent" \\\n  --key /etc/openape/agent.key`
})

const copied = ref('')

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  copied.value = 'text'
  setTimeout(() => copied.value = '', 2000)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-lg bg-gray-900 border border-gray-800">
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold text-white">
            Agents verwalten
          </h1>
          <div class="flex items-center gap-2">
            <UBadge color="neutral" variant="subtle">
              {{ agents.length }}/{{ maxAgents }}
            </UBadge>
            <UButton
              to="/"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              size="sm"
            />
          </div>
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
          to="/login?returnTo=/agents"
          color="primary"
          block
          label="Anmelden"
        />
      </template>

      <template v-else>
        <UAlert
          v-if="justEnrolled"
          color="success"
          title="Agent erfolgreich registriert!"
          class="mb-4"
        />

        <!-- Agent list -->
        <div v-if="agents.length > 0" class="space-y-3 mb-4">
          <NuxtLink
            v-for="agent in agents"
            :key="agent.email"
            :to="`/agents/${encodeURIComponent(agent.email)}`"
            class="block bg-gray-800 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors"
          >
            <div class="flex items-center justify-between">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-white truncate">
                  {{ agent.name }}
                </p>
                <p class="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {{ agent.email }}
                </p>
              </div>
              <div class="flex items-center gap-2 ml-3 shrink-0">
                <span class="text-xs text-gray-500">{{ formatDate(agent.createdAt) }}</span>
                <UBadge :color="agent.isActive ? 'success' : 'error'" size="xs">
                  {{ agent.isActive ? 'Aktiv' : 'Inaktiv' }}
                </UBadge>
                <UIcon name="i-lucide-chevron-right" class="text-gray-500" />
              </div>
            </div>
          </NuxtLink>
        </div>

        <div v-else class="text-center text-gray-400 py-6 mb-4">
          <UIcon name="i-lucide-bot" class="text-3xl mb-2" />
          <p>Noch keine Agents registriert.</p>
        </div>

        <!-- Enrollment section -->
        <UAlert
          v-if="limitReached"
          color="warning"
          title="Agent-Limit erreicht"
          :description="`Du hast bereits ${maxAgents} Agents registriert. Lösche einen bestehenden Agent, um einen neuen zu registrieren.`"
        />

        <template v-else>
          <USeparator v-if="agents.length > 0" class="my-4" />
          <p class="text-sm text-gray-400 mb-3">
            Neuen Agent registrieren
          </p>
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

                <div class="flex items-start gap-2">
                  <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">2</span>
                  <p class="text-sm text-gray-300">
                    Open the enrollment URL that the command outputs in your browser.
                  </p>
                </div>

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
      </template>
    </UCard>
  </div>
</template>
