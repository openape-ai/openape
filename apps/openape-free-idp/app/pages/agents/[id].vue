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
const statusToggling = ref(false)
const statusError = ref('')

const standingGrants = ref<StandingGrant[]>([])
const wizardOpen = ref(false)

// --- YOLO-Modus state ---
interface YoloPolicy {
  agentEmail: string
  enabledBy: string
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | null
  denyPatterns: string[]
  enabledAt: number
  expiresAt: number | null
  updatedAt: number
}

const yoloPolicy = ref<YoloPolicy | null>(null)
const yoloLoading = ref(false)
const yoloError = ref('')
const yoloEditing = ref(false)
const yoloSubmitting = ref(false)
const yoloForm = ref<{
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | ''
  denyPatterns: string
  duration: string // seconds, or '' for unbefristet
}>({
  denyRiskThreshold: 'high',
  denyPatterns: '',
  duration: '3600', // 1 hour default
})
const yoloRiskOptions = [
  { label: 'Kein Schwellwert', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High (empfohlen)', value: 'high' },
  { label: 'Critical', value: 'critical' },
]
const yoloDurationOptions = [
  { label: '1 Stunde (Standard)', value: '3600' },
  { label: '4 Stunden', value: '14400' },
  { label: '8 Stunden', value: '28800' },
  { label: '1 Tag', value: '86400' },
  { label: '7 Tage', value: '604800' },
  { label: '30 Tage', value: '2592000' },
  { label: 'Unbefristet', value: '' },
]
const yoloExpiryLabel = computed(() => {
  const ts = yoloPolicy.value?.expiresAt
  if (!ts) return 'unbefristet'
  return new Date(ts * 1000).toLocaleString()
})

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

async function loadYoloPolicy() {
  if (!agent.value) return
  yoloLoading.value = true
  yoloError.value = ''
  try {
    const res = await ($fetch as any)(`/api/users/${encodeURIComponent(agent.value.email)}/yolo-policy`) as { policy: YoloPolicy | null }
    yoloPolicy.value = res?.policy ?? null
    if (yoloPolicy.value) {
      // When re-opening the form, preselect "unbefristet" when there's
      // already an active policy so we don't silently shorten its expiry.
      yoloForm.value = {
        denyRiskThreshold: (yoloPolicy.value.denyRiskThreshold ?? 'high') as typeof yoloForm.value.denyRiskThreshold,
        denyPatterns: (yoloPolicy.value.denyPatterns ?? []).join('\n'),
        duration: yoloPolicy.value.expiresAt ? '' : '',
      }
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    yoloError.value = e.data?.title ?? 'YOLO-Policy konnte nicht geladen werden'
  }
  finally {
    yoloLoading.value = false
  }
}

async function saveYoloPolicy() {
  if (!agent.value) return
  yoloSubmitting.value = true
  yoloError.value = ''
  try {
    const patterns = yoloForm.value.denyPatterns
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
    const durationSec = Number(yoloForm.value.duration)
    const expiresAt = Number.isFinite(durationSec) && durationSec > 0
      ? Math.floor(Date.now() / 1000) + durationSec
      : null
    const body = {
      denyRiskThreshold: yoloForm.value.denyRiskThreshold || null,
      denyPatterns: patterns,
      expiresAt,
    }
    const res = await ($fetch as any)(
      `/api/users/${encodeURIComponent(agent.value.email)}/yolo-policy`,
      { method: 'PUT', body },
    ) as { policy: YoloPolicy | null }
    yoloPolicy.value = res?.policy ?? null
    yoloEditing.value = false
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, message?: string }
    yoloError.value = e.data?.title ?? e.message ?? 'Speichern fehlgeschlagen'
  }
  finally {
    yoloSubmitting.value = false
  }
}

async function disableYoloPolicy() {
  if (!agent.value) return
  if (!confirm('YOLO-Modus wirklich deaktivieren?')) return
  yoloSubmitting.value = true
  yoloError.value = ''
  try {
    await ($fetch as any)(
      `/api/users/${encodeURIComponent(agent.value.email)}/yolo-policy`,
      { method: 'DELETE' },
    )
    yoloPolicy.value = null
    yoloEditing.value = false
    yoloForm.value = { denyRiskThreshold: 'high', denyPatterns: '', duration: '3600' }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    yoloError.value = e.data?.title ?? 'Deaktivieren fehlgeschlagen'
  }
  finally {
    yoloSubmitting.value = false
  }
}

async function loadAll() {
  await loadAgent()
  await Promise.all([loadStandingGrants(), loadYoloPolicy()])
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

          <details class="bg-gray-800/40 border border-gray-700 rounded-lg">
            <summary class="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 font-medium">
              Authentication
            </summary>
            <div class="px-3 pb-3 pt-1 text-sm text-gray-300 space-y-2">
              <p>
                Der Agent authentifiziert sich über Ed25519 Challenge/Response
                gegen <span class="font-mono text-xs">id.openape.ai</span>.
              </p>
              <p class="text-xs text-gray-400">
                Für eingerichtete OpenApe-Clients übernimmt das die CLI transparent
                — Details + Endpunkte siehe
                <a
                  href="https://docs.openape.ai/getting-started/quickstart-agent"
                  target="_blank"
                  rel="noopener"
                  class="text-orange-400 underline"
                >Quickstart: Agent</a>.
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
          </details>

          <details class="bg-gray-800/40 border border-gray-700 rounded-lg">
            <summary class="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 font-medium">
              Server-seitige Ausführung
            </summary>
            <div class="px-3 pb-3 pt-1 text-sm text-gray-300 space-y-2">
              <p>
                Ein Agent führt Root-Kommandos auf einem Server nicht direkt aus —
                er fordert einen Grant über <span class="font-mono text-xs">apes</span> an.
              </p>
              <pre class="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-200 font-mono overflow-x-auto">apes run --as root -- &lt;command&gt;</pre>
              <p class="text-xs text-gray-400">
                Der darunter liegende <span class="font-mono">escapes</span>-Binary-Flow wird von
                <span class="font-mono">apes</span> orchestriert. Setup + CLI-Referenz in der
                <a
                  href="https://docs.openape.ai/ecosystem/escapes"
                  target="_blank"
                  rel="noopener"
                  class="text-orange-400 underline"
                >Escapes-Doku</a>.
              </p>
            </div>
          </details>

          <details class="bg-gray-800/40 border border-gray-700 rounded-lg" open>
            <summary class="cursor-pointer select-none px-3 py-2 text-sm text-gray-300 font-medium">
              Erlaubte Commands
            </summary>
            <div class="px-3 pb-3">
              <AllowedCommandsList
                :agent-email="agent.email"
                :owner="agent.owner ?? user?.email ?? ''"
                :standing-grants="standingGrants"
                @refresh="loadStandingGrants"
                @add-scoped="openWizard"
              />
            </div>
          </details>

          <!-- YOLO-Modus: Auto-approval für alle Grants dieses Agents -->
          <div class="border border-gray-700 rounded-lg p-4 space-y-3 bg-gray-900/40">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="text-base font-semibold flex items-center gap-2">
                  YOLO-Modus
                  <UBadge v-if="yoloPolicy" color="warning" variant="subtle" size="sm">
                    aktiv
                  </UBadge>
                </h3>
                <p class="text-xs text-gray-400 mt-1">
                  Auto-approval für alle Grant-Requests dieses Agents — außer Deny-Pattern oder
                  Risiko-Schwelle greifen. Nur der Audit-Trail markiert YOLO-Entscheidungen.
                </p>
              </div>
            </div>

            <UAlert
              v-if="yoloError"
              color="error"
              :title="yoloError"
              @close="yoloError = ''"
            />

            <div v-if="yoloLoading" class="text-xs text-gray-400">
              Lade…
            </div>

            <div v-else-if="!yoloPolicy && !yoloEditing">
              <p class="text-sm text-gray-400 mb-3">
                Derzeit inaktiv. Alle Grant-Requests warten auf menschliche Bestätigung.
              </p>
              <UButton
                color="warning"
                icon="i-lucide-zap"
                @click="yoloEditing = true"
              >
                YOLO-Modus aktivieren
              </UButton>
            </div>

            <div v-else-if="yoloPolicy && !yoloEditing" class="space-y-2 text-sm">
              <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span class="text-gray-400">Aktiviert von</span>
                <span class="font-mono text-xs">{{ yoloPolicy.enabledBy }}</span>
                <span class="text-gray-400">Risiko-Schwelle</span>
                <span>
                  <span v-if="yoloPolicy.denyRiskThreshold" class="font-mono">{{ yoloPolicy.denyRiskThreshold }}</span>
                  <span v-else class="italic text-gray-500">keine</span>
                </span>
                <span class="text-gray-400">Deny-Patterns</span>
                <span>
                  <span v-if="yoloPolicy.denyPatterns.length === 0" class="italic text-gray-500">keine</span>
                  <span v-else class="flex flex-wrap gap-1">
                    <code
                      v-for="p in yoloPolicy.denyPatterns"
                      :key="p"
                      class="bg-gray-800 px-2 py-0.5 rounded text-xs"
                    >{{ p }}</code>
                  </span>
                </span>
                <span class="text-gray-400">Ablauf</span>
                <span>{{ yoloExpiryLabel }}</span>
              </div>
              <div class="flex gap-2 pt-2">
                <UButton size="sm" icon="i-lucide-pencil" variant="outline" @click="yoloEditing = true">
                  Bearbeiten
                </UButton>
                <UButton
                  size="sm"
                  color="error"
                  variant="outline"
                  icon="i-lucide-trash-2"
                  :loading="yoloSubmitting"
                  @click="disableYoloPolicy"
                >
                  Deaktivieren
                </UButton>
              </div>
            </div>

            <div v-else class="space-y-3">
              <UFormField label="Dauer" help="Nach Ablauf wird wieder jeder Request manuell bestätigt.">
                <USelect
                  v-model="yoloForm.duration"
                  :items="yoloDurationOptions"
                />
              </UFormField>
              <UFormField label="Risiko-Schwelle" help="Requests mit diesem oder höherem Risiko werden weiter menschlich bestätigt.">
                <USelect
                  v-model="yoloForm.denyRiskThreshold"
                  :items="yoloRiskOptions"
                />
              </UFormField>
              <UFormField label="Deny-Patterns (eine Zeile, Glob-Syntax: * ?)">
                <UTextarea
                  v-model="yoloForm.denyPatterns"
                  :rows="4"
                  placeholder="rm -rf *&#10;sudo *&#10;curl*| sh"
                />
              </UFormField>
              <div class="flex gap-2">
                <UButton color="warning" icon="i-lucide-save" :loading="yoloSubmitting" @click="saveYoloPolicy">
                  {{ yoloPolicy ? 'Speichern' : 'Aktivieren' }}
                </UButton>
                <UButton variant="ghost" :disabled="yoloSubmitting" @click="yoloEditing = false">
                  Abbrechen
                </UButton>
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

    <ScopedCommandWizard
      v-if="agent"
      v-model:open="wizardOpen"
      :agent-email="agent.email"
      @created="onWizardCreated"
    />
  </div>
</template>
