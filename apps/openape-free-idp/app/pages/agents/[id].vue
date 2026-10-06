<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'
import AllowedCommandsList from '../../components/AllowedCommandsList.vue'
import AutomationPolicyCard from '../../components/AutomationPolicyCard.vue'
import ScopedCommandWizard from '../../components/ScopedCommandWizard.vue'
import { BUCKET_DISPLAY } from '../../utils/audience-buckets'

const { user, loading: authLoading } = useIdpAuth()
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
const statusToggling = ref(false)
const statusError = ref('')

const standingGrants = ref<StandingGrant[]>([])
const wizardOpen = ref(false)

// Policy state lives in the per-group AutomationPolicyCard components — each
// card owns its own load/save lifecycle. The page just hands them the agent
// email and lets them render.

// Wildcard fallback + audience mapping are implementation detail — folded
// behind this disclosure instead of getting their own tab.
const advancedOpen = ref(false)
function bucketByValue(value: string) {
  return BUCKET_DISPLAY.find(b => b.id === value) ?? BUCKET_DISPLAY[0]!
}

useSeoMeta({ title: computed(() => agent.value ? `Agent: ${agent.value.name}` : 'Agent') })

async function loadAgent() {
  loading.value = true
  try {
    agent.value = await apiFetch(`/api/my-agents/${encodeURIComponent(String(route.params.id))}`)
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
    const all = await apiFetch('/api/standing-grants') as StandingGrant[]
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

const apesLoginCmd = computed(() => {
  if (!agent.value) return ''
  return `apes login --email "${agent.value.email}" --key ~/.ssh/id_ed25519`
})

const ddisaDomain = computed(() => {
  if (!agent.value) return ''
  const at = agent.value.email.indexOf('@')
  return at >= 0 ? agent.value.email.slice(at + 1) : ''
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

async function toggleActive() {
  if (!agent.value) return
  statusToggling.value = true
  statusError.value = ''
  try {
    await $fetch(`/api/my-agents/${encodeURIComponent(agent.value.email)}`, {
      method: 'PATCH',
      body: { isActive: !agent.value.isActive },
    })
    await loadAgent()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string, title?: string }, message?: string }
    statusError.value = e.data?.statusMessage ?? e.data?.title ?? e.message ?? 'Status-Update fehlgeschlagen'
  }
  finally {
    statusToggling.value = false
  }
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
  <IdpPage
    :title="agent?.name ?? 'Agent'"
    :subtitle="agent?.email"
    back-to="/agents"
    back-label="Agents"
  >
    <div v-if="authLoading || loading" class="text-center text-muted">
      Loading...
    </div>

    <template v-else-if="!user">
      <p class="mb-4 text-center text-muted">
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
          <p class="mb-1 text-sm text-muted">
            Name
          </p>
          <div class="flex items-center gap-2">
            <pre class="flex-1 overflow-x-auto rounded-lg border border-default bg-elevated px-3 py-2 text-sm text-default">{{ agent.name }}</pre>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="copied === 'name' ? 'i-lucide-check' : 'i-lucide-copy'"
              aria-label="Agent-Namen kopieren"
              @click="copyField('name', agent.name)"
            />
          </div>
        </div>

        <div>
          <p class="mb-1 text-sm text-muted">
            Email
          </p>
          <div class="flex items-center gap-2">
            <pre class="flex-1 overflow-x-auto rounded-lg border border-default bg-elevated px-3 py-2 font-mono text-xs text-default">{{ agent.email }}</pre>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="copied === 'email' ? 'i-lucide-check' : 'i-lucide-copy'"
              aria-label="Agent-Email kopieren"
              @click="copyField('email', agent.email)"
            />
          </div>
        </div>

        <div>
          <p class="mb-1 text-sm text-muted">
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
            <div class="mt-2 flex gap-2">
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
            <pre class="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-default bg-elevated px-3 py-2 font-mono text-xs text-default">{{ agent.publicKey }}</pre>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              aria-label="Public Key bearbeiten"
              @click="startEditKey"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="copied === 'key' ? 'i-lucide-check' : 'i-lucide-copy'"
              aria-label="Public Key kopieren"
              @click="copyField('key', agent.publicKey)"
            />
          </div>
        </div>

        <div>
          <p class="mb-1 text-sm text-muted">
            Status
          </p>
          <div class="flex items-center gap-3">
            <UBadge :color="agent.isActive ? 'success' : 'error'">
              {{ agent.isActive ? 'Aktiv' : 'Inaktiv' }}
            </UBadge>
            <UButton
              size="xs"
              variant="outline"
              :loading="statusToggling"
              :icon="agent.isActive ? 'i-lucide-pause' : 'i-lucide-play'"
              :label="agent.isActive ? 'Deaktivieren' : 'Aktivieren'"
              @click="toggleActive"
            />
          </div>
          <UAlert v-if="statusError" color="error" :title="statusError" class="mt-2" @close="statusError = ''" />
          <p class="mt-1 text-xs text-dimmed">
            Inaktive Agents können nicht mehr authentifizieren.
          </p>
        </div>

        <!-- Freigabe-Regeln: zwei sichtbare Gruppen (Kommandos inkl. Root,
             Netzwerk); Wildcard-Fallback, Audience-Zuordnung und Roadmap-
             Hinweise stecken hinter „Erweitert". Auth-Details sind ein
             Help-Popover. -->
        <div class="rounded-lg border border-default">
          <div class="flex items-center justify-between gap-2 border-b border-default bg-elevated/40 px-3 py-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-muted">
              <UIcon name="i-lucide-shield-check" class="size-4 text-muted" />
              Freigabe-Regeln
            </h2>
            <UPopover :content="{ side: 'bottom', align: 'end' }">
              <UButton
                icon="i-lucide-help-circle"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Authentifizierung erklärt"
              />
              <template #content>
                <div class="max-w-md space-y-3 p-4 text-sm text-default">
                  <h3 class="font-semibold">
                    Authentifizierung
                  </h3>
                  <div class="space-y-1">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">
                      1) Bei OpenApe anmelden
                    </h4>
                    <p class="text-xs text-muted">
                      Ed25519-Challenge/Response mit dem privaten Schlüssel. Danach kann der Agent Grants anfordern.
                    </p>
                    <div class="relative">
                      <pre class="overflow-x-auto rounded border border-default bg-elevated p-2 pr-8 font-mono text-xs text-default">{{ apesLoginCmd }}</pre>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :icon="copied === 'apesLogin' ? 'i-lucide-check' : 'i-lucide-copy'"
                        class="absolute top-1.5 right-1.5"
                        aria-label="Login-Command kopieren"
                        @click="copyField('apesLogin', apesLoginCmd)"
                      />
                    </div>
                  </div>
                  <div class="space-y-1">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-dimmed">
                      2) DDISA-Login auf SPs
                    </h4>
                    <p class="text-xs text-muted">
                      Jede DDISA-fähige Website löst <span class="font-mono">_ddisa.{{ ddisaDomain }}</span> per DNS auf und vertraut diesem IdP.
                      <a
                        href="https://docs.openape.ai/getting-started/how-it-works"
                        target="_blank"
                        rel="noopener"
                        class="text-primary underline"
                      >Mehr</a>.
                    </p>
                  </div>
                </div>
              </template>
            </UPopover>
          </div>
          <div class="space-y-3 p-3">
            <p class="text-xs text-dimmed">
              Standard: jede Aktion braucht deine Freigabe. Hier legst du fest, was ohne Rückfrage laufen darf — und was immer blockiert ist.
            </p>

            <AutomationPolicyCard
              :agent-email="agent.email"
              :bucket="bucketByValue('commands')"
            >
              <template #allow-extra>
                <div class="mt-3 border-t border-gray-800 pt-3">
                  <AllowedCommandsList
                    :agent-email="agent.email"
                    :owner="agent.owner ?? user?.email ?? ''"
                    :standing-grants="standingGrants"
                    @refresh="loadStandingGrants"
                    @add-scoped="openWizard"
                  />
                </div>
              </template>
            </AutomationPolicyCard>

            <AutomationPolicyCard
              :agent-email="agent.email"
              :bucket="bucketByValue('root')"
            />

            <AutomationPolicyCard
              :agent-email="agent.email"
              :bucket="bucketByValue('web')"
            />

            <div>
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-muted hover:text-default"
                @click="advancedOpen = !advancedOpen"
              >
                {{ advancedOpen ? '▾' : '▸' }} Erweitert
              </button>
              <div v-if="advancedOpen" class="mt-3 space-y-3">
                <p class="text-xs text-dimmed">
                  Technische Zuordnung: Kommandos = <span class="font-mono">ape-shell, claude-code, shapes</span> · Als Root = <span class="font-mono">escapes</span> · Netzwerk = <span class="font-mono">ape-proxy</span> · Fallback = alle übrigen Audiences (<span class="font-mono">*</span>).
                </p>
                <UAlert
                  v-if="bucketByValue('web').notice"
                  color="info"
                  variant="subtle"
                  icon="i-lucide-info"
                  :title="bucketByValue('web').notice"
                />
                <AutomationPolicyCard
                  :agent-email="agent.email"
                  :bucket="bucketByValue('default')"
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

    <ScopedCommandWizard
      v-if="agent"
      v-model:open="wizardOpen"
      :agent-email="agent.email"
      @created="onWizardCreated"
    />
  </IdpPage>
</template>
