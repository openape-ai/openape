<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'

useSeoMeta({ title: 'Agents verwalten' })

const { user, loading: authLoading } = useIdpAuth()
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

// Derive the IdP the user is actually on, so the enrol instructions + the
// previewed agent email point at THIS instance (id.openape.ai, id.openape.at,
// a self-hosted IdP) instead of a hardcoded one — matching the issuer-host
// derivation the enroll endpoint uses for the real agent email.
const idpUrl = useRequestURL()
const idpOrigin = idpUrl.origin
const idpHost = idpUrl.host

const agentInstructions = computed(() => {
  return `Generate an Ed25519 keypair and open this URL in the user's browser:\n\n${idpOrigin}/enroll?name=<agent-name>&key=<url-encoded-public-key>\n\nParameters:\n- name: your agent's display name\n- key: the full public key in OpenSSH format (ssh-ed25519 AAAA...), URL-encoded (percent-encode spaces as %20)\n\nThe agent email will be automatically derived from the logged-in user's email.`
})

const sudoCommand = computed(() => {
  const email = user.value?.email ?? ''
  const name = email.split('@')[0] ?? 'agent'
  const [local, domain] = email.split('@')
  const agentEmail = `agent+${local}+${(domain ?? '').replace(/\./g, '_')}@${idpHost}`
  return `sudo escapes enroll \\\n  --server ${idpOrigin} \\\n  --agent-email "${agentEmail}" \\\n  --agent-name "${name}-agent" \\\n  --key /etc/openape/agent.key`
})

const copied = ref('')

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  copied.value = 'text'
  setTimeout(() => copied.value = '', 2000)
}

// Bulk-apply safe commands
const bulkOpen = ref(false)
const bulkSelected = ref<Set<string>>(new Set())
const bulkBusy = ref(false)
const bulkResults = ref<Array<{ delegate: string, created: number, skipped: number }> | null>(null)
const bulkError = ref('')

function openBulk() {
  bulkSelected.value = new Set(agents.value.map(a => a.email))
  bulkResults.value = null
  bulkError.value = ''
  bulkOpen.value = true
}

function toggleBulkSelect(email: string, checked: boolean) {
  const next = new Set(bulkSelected.value)
  if (checked) next.add(email)
  else next.delete(email)
  bulkSelected.value = next
}

async function applyBulk() {
  bulkBusy.value = true
  bulkError.value = ''
  try {
    const res = await ($fetch as any)('/api/standing-grants/bulk-seed', {
      method: 'POST',
      body: { delegates: [...bulkSelected.value] },
    }) as { results: Array<{ delegate: string, created: number, skipped: number }> }
    bulkResults.value = res.results
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string } }
    bulkError.value = e.data?.detail ?? e.data?.title ?? 'Bulk-apply fehlgeschlagen'
  }
  finally {
    bulkBusy.value = false
  }
}

function closeBulk() {
  if (bulkBusy.value) return
  bulkOpen.value = false
}

const bulkTotalCreated = computed(() =>
  bulkResults.value ? bulkResults.value.reduce((s, r) => s + r.created, 0) : 0,
)
</script>

<template>
  <IdpPage title="Agents" :subtitle="user?.email" back-to="/account" back-label="Account">
    <template #actions>
      <UBadge color="neutral" variant="subtle">
        {{ agents.length }}/{{ maxAgents }}
      </UBadge>
      <UButton
        v-if="agents.length > 0"
        color="primary"
        variant="soft"
        size="xs"
        icon="i-lucide-shield-check"
        @click="openBulk"
      >
        Safe Commands
      </UButton>
    </template>

    <div v-if="authLoading || loading" class="text-center text-muted">
      Loading...
    </div>

    <template v-else-if="!user">
      <p class="mb-4 text-center text-muted">
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
      <div v-if="agents.length > 0" class="space-y-3">
        <NuxtLink
          v-for="agent in agents"
          :key="agent.email"
          :to="`/agents/${encodeURIComponent(agent.email)}`"
          class="block rounded-lg border border-default bg-default p-3 transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <div class="flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ agent.name }}
              </p>
              <p class="mt-0.5 truncate font-mono text-xs text-muted">
                {{ agent.email }}
              </p>
            </div>
            <div class="ml-3 flex shrink-0 items-center gap-2">
              <span class="text-xs text-dimmed">{{ formatDate(agent.createdAt) }}</span>
              <UBadge :color="agent.isActive ? 'success' : 'error'" size="xs">
                {{ agent.isActive ? 'Aktiv' : 'Inaktiv' }}
              </UBadge>
              <UIcon name="i-lucide-chevron-right" class="text-dimmed" />
            </div>
          </div>
        </NuxtLink>
      </div>

      <div v-else class="py-6 text-center text-muted">
        <UIcon name="i-lucide-bot" class="mb-2 text-3xl" />
        <p>Noch keine Agents registriert.</p>
      </div>

      <!-- Enrollment section -->
      <UAlert
        v-if="limitReached"
        color="warning"
        title="Agent-Limit erreicht"
        :description="`Du hast bereits ${maxAgents} Agents registriert. Lösche einen bestehenden Agent, um einen neuen zu registrieren.`"
        class="mt-6"
      />

      <UCard v-else class="mt-6">
        <template #header>
          <h2 class="text-sm font-semibold">
            Neuen Agent registrieren
          </h2>
        </template>

        <UTabs
          default-value="agent"
          :items="[
            { label: 'Enroll with agent', value: 'agent', slot: 'agent' },
            { label: 'Enroll with escapes', value: 'sudo', slot: 'sudo' },
          ]"
        >
          <template #agent>
            <div class="space-y-5 pt-4">
              <p class="text-sm text-muted">
                Paste the following instructions to your AI agent so it can generate an enrollment URL for you.
              </p>

              <div class="relative">
                <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-default bg-elevated p-3 pr-10 font-mono text-xs text-default">{{ agentInstructions }}</pre>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :icon="copied === 'text' ? 'i-lucide-check' : 'i-lucide-copy'"
                  class="absolute top-2 right-2"
                  aria-label="Anweisungen kopieren"
                  @click="copyText(agentInstructions)"
                />
              </div>

              <p class="text-sm text-muted">
                Once the agent gives you the URL, open it in your browser and confirm the enrollment.
              </p>
            </div>
          </template>

          <template #sudo>
            <div class="space-y-5 pt-4">
              <p class="text-sm text-muted">
                Run this command on the machine where your agent should run.
              </p>

              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-inverted">1</span>
                  <p class="text-sm text-muted">
                    Run this on the target machine:
                  </p>
                </div>
                <div class="relative">
                  <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-default bg-elevated p-3 pr-10 font-mono text-xs text-default">{{ sudoCommand }}</pre>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="copied === 'text' ? 'i-lucide-check' : 'i-lucide-copy'"
                    class="absolute top-2 right-2"
                    aria-label="Command kopieren"
                    @click="copyText(sudoCommand.replace(/\\\n\s*/g, ''))"
                  />
                </div>
              </div>

              <div class="flex items-start gap-2">
                <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-inverted">2</span>
                <p class="text-sm text-muted">
                  Open the enrollment URL that the command outputs in your browser.
                </p>
              </div>

              <div class="flex items-start gap-2">
                <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-inverted">3</span>
                <p class="text-sm text-muted">
                  Confirm the enrollment. Your agent can then authenticate via challenge-response.
                </p>
              </div>
            </div>
          </template>
        </UTabs>
      </UCard>
    </template>

    <UModal v-model:open="bulkOpen" :dismissible="!bulkBusy">
      <template #content>
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Safe Commands auf alle Agents anwenden
            </h3>
            <p class="mt-1 text-sm text-muted">
              Jeder ausgewählte Agent erhält die 14 Default-Safe-Command-Standing-Grants. Bereits vorhandene Einträge werden übersprungen.
            </p>
          </template>

          <UAlert
            v-if="bulkError"
            color="error"
            :title="bulkError"
            class="mb-3"
            @close="bulkError = ''"
          />

          <div v-if="!bulkResults" class="max-h-80 space-y-2 overflow-y-auto">
            <label
              v-for="a in agents"
              :key="a.email"
              class="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-elevated"
            >
              <UCheckbox
                :model-value="bulkSelected.has(a.email)"
                @update:model-value="(v: boolean | 'indeterminate') => toggleBulkSelect(a.email, v === true)"
              />
              <div class="min-w-0 text-sm">
                <div class="truncate font-medium">
                  {{ a.name }}
                </div>
                <div class="truncate font-mono text-xs text-muted">
                  {{ a.email }}
                </div>
              </div>
            </label>
          </div>

          <div v-else class="space-y-2 text-sm">
            <div class="mb-2 text-xs text-muted">
              {{ bulkTotalCreated }} neue Standing Grant{{ bulkTotalCreated === 1 ? '' : 's' }} über {{ bulkResults.length }} Agent{{ bulkResults.length === 1 ? '' : 's' }} erzeugt.
            </div>
            <div
              v-for="r in bulkResults"
              :key="r.delegate"
              class="flex items-center justify-between border-b border-default px-2 py-1"
            >
              <code class="break-all font-mono text-xs text-default">{{ r.delegate }}</code>
              <span class="ml-2 shrink-0 text-xs text-dimmed">
                +{{ r.created }} · {{ r.skipped }} skipped
              </span>
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" :disabled="bulkBusy" @click="closeBulk">
                {{ bulkResults ? 'Schließen' : 'Abbrechen' }}
              </UButton>
              <UButton
                v-if="!bulkResults"
                color="primary"
                :loading="bulkBusy"
                :disabled="bulkBusy || bulkSelected.size === 0"
                @click="applyBulk"
              >
                Anwenden
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </IdpPage>
</template>
