<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth } from '#imports'
import AllowedCommandsList from '../../components/AllowedCommandsList.vue'
import BucketYoloCard from '../../components/BucketYoloCard.vue'
import ScopedCommandWizard from '../../components/ScopedCommandWizard.vue'
import { BUCKET_DISPLAY } from '../../utils/audience-buckets'

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
const statusToggling = ref(false)
const statusError = ref('')

const standingGrants = ref<StandingGrant[]>([])
const wizardOpen = ref(false)

// YOLO state moved into per-bucket BucketYoloCard components — each card owns
// its own load/save lifecycle. The page just hands them the agent email and
// lets them render.

// Tab navigation for the bucket sections. Commands is the default landing
// tab because Standing Grants currently only live there (Web/Root will get
// their own surfaces in a follow-up PR).
const activeBucketTab = ref('commands')
const bucketTabItems = computed(() => BUCKET_DISPLAY.map(b => ({
  label: b.label,
  value: b.id,
  icon: b.icon,
  slot: b.id,
})))
function bucketByValue(value: string) {
  return BUCKET_DISPLAY.find(b => b.id === value) ?? BUCKET_DISPLAY[0]!
}

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
            <p class="text-xs text-gray-500 mt-1">
              Inaktive Agents können nicht mehr authentifizieren.
            </p>
          </div>

          <!-- Per-Bucket Tabs: Authorization-Layer (Commands / Web / Root /
               Default-Fallback). Standing-Grants-Liste für "Erlaubte Commands"
               ist nur unter Commands sichtbar — Web und Root haben heute noch
               keine eigene UI dafür, kommt in Folge-PRs. Auth-Details sind
               jetzt ein Help-Popover statt eines Accordion-Blocks. -->
          <div class="border border-gray-700 rounded-lg overflow-hidden">
            <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700 bg-gray-800/40">
              <h2 class="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <UIcon name="i-lucide-shield-check" class="w-4 h-4 text-gray-400" />
                Auto-Approval (YOLO) + Standing Grants
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
                  <div class="p-4 max-w-md text-sm text-gray-200 space-y-3">
                    <h3 class="font-semibold text-gray-100">
                      Authentifizierung
                    </h3>
                    <div class="space-y-1">
                      <h4 class="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                        1) Bei OpenApe anmelden
                      </h4>
                      <p class="text-xs text-gray-400">
                        Ed25519-Challenge/Response mit dem privaten Schlüssel. Danach kann der Agent Grants anfordern.
                      </p>
                      <div class="relative">
                        <pre class="bg-gray-800 border border-gray-700 rounded p-2 pr-8 text-xs text-gray-200 font-mono overflow-x-auto">{{ apesLoginCmd }}</pre>
                        <UButton
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          :icon="copied === 'apesLogin' ? 'i-lucide-check' : 'i-lucide-copy'"
                          class="absolute top-1.5 right-1.5"
                          @click="copyField('apesLogin', apesLoginCmd)"
                        />
                      </div>
                    </div>
                    <div class="space-y-1">
                      <h4 class="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                        2) DDISA-Login auf SPs
                      </h4>
                      <p class="text-xs text-gray-400">
                        Jede DDISA-fähige Website löst <span class="font-mono">_ddisa.{{ ddisaDomain }}</span> per DNS auf und vertraut diesem IdP.
                        <a
                          href="https://docs.openape.ai/getting-started/how-it-works"
                          target="_blank"
                          rel="noopener"
                          class="text-orange-400 underline"
                        >Mehr</a>.
                      </p>
                    </div>
                  </div>
                </template>
              </UPopover>
            </div>
            <UTabs
              v-model="activeBucketTab"
              :items="bucketTabItems"
              :unmount-on-hide="false"
              variant="link"
              size="sm"
              color="primary"
            >
              <template #commands>
                <div class="space-y-3 p-3">
                  <BucketYoloCard
                    :agent-email="agent.email"
                    :bucket="bucketByValue('commands')"
                  />
                  <div>
                    <h3 class="text-sm font-semibold text-gray-300 mb-2 mt-2">
                      Erlaubte Commands (Standing Grants)
                    </h3>
                    <AllowedCommandsList
                      :agent-email="agent.email"
                      :owner="agent.owner ?? user?.email ?? ''"
                      :standing-grants="standingGrants"
                      @refresh="loadStandingGrants"
                      @add-scoped="openWizard"
                    />
                  </div>
                </div>
              </template>
              <template #web>
                <div class="p-3">
                  <BucketYoloCard
                    :agent-email="agent.email"
                    :bucket="bucketByValue('web')"
                  />
                </div>
              </template>
              <template #root>
                <div class="p-3">
                  <BucketYoloCard
                    :agent-email="agent.email"
                    :bucket="bucketByValue('root')"
                  />
                </div>
              </template>
              <template #default>
                <div class="p-3">
                  <BucketYoloCard
                    :agent-email="agent.email"
                    :bucket="bucketByValue('default')"
                  />
                </div>
              </template>
            </UTabs>
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

    <ScopedCommandWizard
      v-if="agent"
      v-model:open="wizardOpen"
      :agent-email="agent.email"
      @created="onWizardCreated"
    />
  </div>
</template>
