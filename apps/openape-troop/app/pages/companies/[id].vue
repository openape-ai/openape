<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Company detail — the hierarchy chart + business tabs for one company.
// (B0 merge: this is the former org.openape.ai org-detail view, now in troop.)
// The CEO is the Owner's front door; the structure is preserved.
const route = useRoute()
const orgId = computed(() => String(route.params.id))

useSeoMeta({ title: () => 'Firma' })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Org { id: string, name: string, visionMd: string, budgetMonthlyEur: number }
interface Member { orgId: string, agentEmail: string, agentName: string, role: string, persona: string | null, personaTitle?: string | null, personaIcon?: string | null, reportsToEmail: string | null, status: string }

const org = ref<Org | null>(null)
const members = ref<Member[]>([])
const loading = ref(true)
const error = ref('')

const ownerEmail = computed(() => (user.value as { sub?: string } | null)?.sub ?? '')

async function loadMembers() { members.value = await ($fetch as any)(`/api/orgs/${orgId.value}/members`) }

// Nest-less agents: the CEO's local delegation team (cockpit_agents).
interface LocalAgent { id: string, role: string, label: string, duties: string, tools: string[], enabled: boolean }
const localAgents = ref<LocalAgent[]>([])
async function loadLocal() { localAgents.value = await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents`) }
async function load() {
  loading.value = true
  error.value = ''
  try {
    org.value = await ($fetch as any)(`/api/orgs/${orgId.value}`)
    await Promise.all([loadMembers(), loadLocal()])
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte die Firma nicht laden.'
  }
  finally { loading.value = false }
}

// ── Tabs ──
const tab = ref<'firma' | 'ziele' | 'reports' | 'kosten'>('firma')
const TABS = [
  { key: 'firma', label: 'Firma', icon: 'i-lucide-building-2' },
  { key: 'ziele', label: 'Ziele', icon: 'i-lucide-target' },
  { key: 'reports', label: 'Reports', icon: 'i-lucide-file-text' },
  { key: 'kosten', label: 'Kosten', icon: 'i-lucide-wallet' },
] as const

// ── Add a role (unified) ──
// One form: an optional template pre-fills Name/Werkzeuge/Beschreibung, then you
// edit freely. Creates a local role (cockpit_agents) the CEO delegates to.
// „Werkzeuge" = wildcard command patterns (e.g. `o365-cli *`) — Stage 1 toward
// real scoped command grants (free-idp AllowedCommands/ScopedCommandWizard).
interface RoleTemplate { key: string, label: string, name: string, tools: string, duties: string }
const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: '', label: 'Keine Vorlage (leer)', name: '', tools: '', duties: '' },
  { key: 'mail-m365', label: 'Mail-Beauftragter · Microsoft 365', name: 'Mail-Beauftragter', tools: 'o365-cli *', duties: 'Liest die Inbox read-only, meldet die handlungsrelevanten Mails und öffnet Anhänge (PDF) auf Nachfrage. Sendet/verschiebt/löscht/markiert NIE.' },
  { key: 'mail-gmail', label: 'Mail-Beauftragter · Gmail', name: 'Mail-Beauftragter', tools: 'gmail-cli *', duties: 'Liest die Gmail-Inbox read-only und meldet die handlungsrelevanten Mails. Sendet/verschiebt/löscht NIE.' },
  { key: 'calendar', label: 'Kalender-Beauftragter', name: 'Kalender-Beauftragter', tools: 'o365-cli *', duties: 'Prüft anstehende Termine read-only und meldet Konflikte / Vorbereitungsbedarf.' },
  { key: 'docs', label: 'Dokument-Leser', name: 'Dokument-Leser', tools: 'pdftotext *\npdfinfo *', duties: 'Liest PDF-/Dokument-Inhalte read-only und fasst die relevanten Fakten/Zahlen zusammen.' },
]
const templateItems = ROLE_TEMPLATES.map(t => ({ label: t.label, value: t.key }))
const showAdd = ref(false)
const templateKey = ref('')
const roleForm = reactive({ name: '', tools: '', duties: '' })
const adding = ref(false)
const addError = ref('')
function applyTemplate(key: string) {
  const t = ROLE_TEMPLATES.find(x => x.key === key) ?? ROLE_TEMPLATES[0]!
  roleForm.name = t.name; roleForm.tools = t.tools; roleForm.duties = t.duties
}
function openAdd() {
  addError.value = ''
  templateKey.value = ''
  roleForm.name = ''; roleForm.tools = ''; roleForm.duties = ''
  showAdd.value = true
}
watch(templateKey, applyTemplate)
async function submitAdd() {
  if (!roleForm.name.trim()) { addError.value = 'Name angeben.'; return }
  adding.value = true
  addError.value = ''
  try {
    await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents`, { method: 'POST', body: {
      label: roleForm.name.trim(),
      role: 'specialist',
      duties: roleForm.duties.trim(),
      tools: roleForm.tools.split(/[\n,]/).map((t: string) => t.trim()).filter(Boolean),
    } })
    showAdd.value = false
    await loadLocal()
  }
  catch (err: any) { addError.value = err?.data?.statusMessage || 'Anlegen fehlgeschlagen.' }
  finally { adding.value = false }
}

async function deleteLocal(a: { id: string }) {
  await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents/${a.id}`, { method: 'DELETE' })
  await loadLocal()
}
async function toggleLocal(a: { id: string, enabled: boolean }) {
  await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } })
  await loadLocal()
}

// ── Spawn ──
const spawning = reactive<Record<string, string>>({})
async function spawnMember(m: { agentEmail: string, persona: string | null }) {
  if (!m.persona) return
  spawning[m.agentEmail] = 'startet …'
  try {
    await ($fetch as any)(`/api/orgs/${orgId.value}/members/${encodeURIComponent(m.agentEmail)}/spawn`, { method: 'POST' })
    spawning[m.agentEmail] = 'wartet auf Freigabe …'
    await pollSpawn(m.agentEmail)
  }
  catch (err: any) {
    spawning[m.agentEmail] = err?.data?.statusMessage || 'Spawn fehlgeschlagen'
    setTimeout(() => { delete spawning[m.agentEmail] }, 4000)
  }
}
async function pollSpawn(email: string) {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await ($fetch as any)(`/api/orgs/${orgId.value}/members/${encodeURIComponent(email)}/spawn-status`)
    if (res.status === 'active') { delete spawning[email]; await loadMembers(); return }
    if (res.status === 'failed') { spawning[email] = res.error || 'Spawn fehlgeschlagen'; setTimeout(() => { delete spawning[email] }, 5000); return }
  }
  delete spawning[email]
}

// ── Edit org ──
const showEdit = ref(false)
const editForm = reactive({ name: '', vision: '', budget: 0 })
const savingEdit = ref(false)
function openEdit() {
  if (!org.value) return
  editForm.name = org.value.name
  editForm.vision = org.value.visionMd
  editForm.budget = org.value.budgetMonthlyEur
  showEdit.value = true
}
async function saveOrg() {
  savingEdit.value = true
  try {
    await ($fetch as any)(`/api/orgs/${orgId.value}`, { method: 'PATCH', body: { name: editForm.name.trim(), vision_md: editForm.vision.trim(), budget_monthly_eur: editForm.budget } })
    showEdit.value = false
    await load()
  }
  finally { savingEdit.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-zinc-800/80 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <UButton to="/companies" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-left">
          Firmen
        </UButton>
      </div>
      <ViewToggle active="companies" />
    </header>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <div v-if="loading" class="text-zinc-500 py-20 text-center">
        Lädt …
      </div>
      <UAlert v-else-if="error" color="error" variant="subtle" :title="error" />

      <template v-else-if="org">
        <div class="mb-6">
          <div class="flex items-center justify-end gap-2 mb-3">
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEdit">
              Bearbeiten
            </UButton>
            <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-user-plus" @click="openAdd()">
              Hinzufügen
            </UButton>
          </div>
          <h2 class="text-3xl font-bold tracking-tight">
            {{ org.name }}
          </h2>
          <MarkdownText v-if="org.visionMd" :content="org.visionMd" class="mt-2 text-zinc-400" />
        </div>

        <div class="flex gap-1 border-b border-zinc-800/80 mb-8 overflow-x-auto">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 shrink-0"
            :class="tab === t.key ? 'border-primary-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'"
            @click="tab = t.key"
          >
            <UIcon :name="t.icon" class="size-4" />
            {{ t.label }}
          </button>
        </div>

        <section v-if="tab === 'firma'" class="mb-10">
          <CompanyChart :members="members" :local-agents="localAgents" :owner-email="ownerEmail" :spawning="spawning" @spawn="spawnMember" @add-local="openAdd()" @delete-local="deleteLocal" @toggle-local="toggleLocal" />
        </section>

        <CompanyObjectives v-if="tab === 'ziele'" :org-id="orgId" />
        <CompanyReports v-if="tab === 'reports'" :org-id="orgId" />
        <CompanyCosts v-if="tab === 'kosten'" :org-id="orgId" :budget-eur="org.budgetMonthlyEur" />
      </template>
    </main>

    <!-- Add a role — one form, optional template -->
    <UModal v-model:open="showAdd" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              Rolle hinzufügen
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showAdd = false" />
          </div>
          <UFormField label="Vorlage" description="Optional — füllt Name, Werkzeuge und Beschreibung vor. Danach frei editierbar.">
            <USelect v-model="templateKey" :items="templateItems" placeholder="Keine Vorlage" class="w-full" />
          </UFormField>
          <UFormField label="Name">
            <UInput v-model="roleForm.name" placeholder="Mail-Beauftragter" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Werkzeuge" description="Im Terminal verfügbare Kommandos als Muster, eines pro Zeile — z. B. o365-cli *">
            <UTextarea v-model="roleForm.tools" :rows="2" placeholder="o365-cli *" class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Beschreibung" description="Was tut die Rolle? Read-only — der CEO delegiert danach.">
            <UTextarea v-model="roleForm.duties" :rows="3" placeholder="Liest die Inbox read-only und meldet die handlungsrelevanten Mails." class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="addError" color="error" variant="subtle" :title="addError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showAdd = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="adding" @click="submitAdd">
              Hinzufügen
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Edit org modal -->
    <UModal v-model:open="showEdit" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              Firma bearbeiten
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showEdit = false" />
          </div>
          <UFormField label="Name">
            <UInput v-model="editForm.name" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Vision" description="Der CEO liest das bei jeder Interaktion.">
            <UTextarea v-model="editForm.vision" :rows="5" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Monatsbudget (EUR)">
            <UInput v-model.number="editForm.budget" type="number" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showEdit = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="savingEdit" @click="saveOrg">
              Speichern
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
