<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Company detail — its employees (the whole hierarchy) + business tabs. troop
// defines the workforce; a provider (Claude session today, a nest later) runs it.
const route = useRoute()
const orgId = computed(() => String(route.params.id))
useSeoMeta({ title: () => 'Firma' })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Org { id: string, name: string, visionMd: string, budgetMonthlyEur: number }
interface Employee { id: string, role: string, label: string, duties: string, tools: string[], enabled: boolean, reportsTo: string | null }

const org = ref<Org | null>(null)
const employees = ref<Employee[]>([])
const loading = ref(true)
const error = ref('')
const ownerEmail = computed(() => (user.value as { sub?: string } | null)?.sub ?? '')

async function loadEmployees() { employees.value = await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents`) }

// Provider status — the agentic provider running this company (today: the Claude
// session loop). Reuses the cockpit presence (active/idle/working/offline).
const providerMode = ref<'active' | 'idle' | 'working' | 'offline'>('offline')
const providerLabel = computed(() => ({ active: 'Aktiv', idle: 'Ruhend', working: 'Arbeitet', offline: 'Offline' }[providerMode.value]))
const providerColor = computed(() => ({ active: 'success', idle: 'info', working: 'warning', offline: 'neutral' } as const)[providerMode.value])
async function loadProvider() {
  try { providerMode.value = (await ($fetch as any)('/api/cockpit/status')).mode }
  catch { providerMode.value = 'offline' }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    org.value = await ($fetch as any)(`/api/orgs/${orgId.value}`)
    await Promise.all([loadEmployees(), loadProvider()])
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || 'Konnte die Firma nicht laden.'
  }
  finally { loading.value = false }
}

const tab = ref<'firma' | 'ziele' | 'reports' | 'kosten'>('firma')
const TABS = [
  { key: 'firma', label: 'Firma', icon: 'i-lucide-building-2' },
  { key: 'ziele', label: 'Ziele', icon: 'i-lucide-target' },
  { key: 'reports', label: 'Reports', icon: 'i-lucide-file-text' },
  { key: 'kosten', label: 'Kosten', icon: 'i-lucide-wallet' },
] as const

// ── Employee form (add + edit) ──
// An optional template pre-fills Name/Rolle/Werkzeuge/Beschreibung, then edit
// freely. „Werkzeuge" = wildcard command patterns (e.g. `o365-cli *`).
interface RoleTemplate { key: string, label: string, name: string, role: string, tools: string, duties: string }
const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: '', label: 'Keine Vorlage (leer)', name: '', role: 'specialist', tools: '', duties: '' },
  { key: 'ceo', label: 'CEO', name: 'CEO', role: 'ceo', tools: 'ape-tasks *', duties: 'Führt die Firma, kommuniziert mit dem Owner und skaliert das Team hoch/runter. Verdichtet die Meldungen der Mitarbeiter zu Handlungsbedarf.' },
  { key: 'pm', label: 'Projektmanager', name: 'Projektmanager', role: 'teamlead', tools: 'ape-tasks *', duties: 'Pflegt Backlog/Aufgaben, plant, hält Termine/Blocker sichtbar.' },
  { key: 'mail-m365', label: 'Mail-Assistent · Microsoft 365', name: 'Mail-Assistent', role: 'specialist', tools: 'o365-cli *\npdftotext *', duties: 'Triagiert die Inbox read-only, meldet die handlungsrelevanten Mails und liest Anhänge (PDF) auf Nachfrage. Sendet/verschiebt/löscht NIE.' },
  { key: 'mail-gmail', label: 'Mail-Assistent · Gmail', name: 'Mail-Assistent', role: 'specialist', tools: 'gmail-cli *', duties: 'Triagiert die Gmail-Inbox read-only und meldet die handlungsrelevanten Mails. Sendet/verschiebt/löscht NIE.' },
  { key: 'buchhaltung', label: 'Buchhaltung', name: 'Buchhaltung', role: 'specialist', tools: 'o365-cli *\npdftotext *', duties: 'Sichtet Belege/Eingangsrechnungen read-only, bereitet Ablage nach Bill-To-Regeln vor. Bucht/zahlt nichts selbst — legt Vorschläge vor.' },
  { key: 'social', label: 'Social Media', name: 'Social Media', role: 'specialist', tools: '', duties: 'Entwirft LinkedIn/X-Posts (blog-first) aus delta-mind.at-Inhalten. Postet nichts selbst — legt Entwürfe vor.' },
  { key: 'docs', label: 'Dokument-Leser', name: 'Dokument-Leser', role: 'specialist', tools: 'pdftotext *\npdfinfo *', duties: 'Liest PDF-/Dokument-Inhalte read-only und fasst die relevanten Fakten/Zahlen zusammen.' },
]
const templateItems = ROLE_TEMPLATES.map(t => ({ label: t.label, value: t.key }))
const roleItems = [
  { label: 'CEO', value: 'ceo' },
  { label: 'Team-Lead', value: 'teamlead' },
  { label: 'Specialist', value: 'specialist' },
]
const roleLabelShort: Record<string, string> = { ceo: 'CEO', teamlead: 'Team-Lead', specialist: 'Specialist', sanierer: 'Controlling', other: 'Mitarbeiter' }
const editingId = ref<string | null>(null)
const supervisorItems = computed(() => [
  { label: '— Owner (kein Vorgesetzter)', value: '' },
  ...employees.value.filter(e => e.id !== editingId.value).map(e => ({ label: `${e.label} · ${roleLabelShort[e.role] ?? e.role}`, value: e.id })),
])
const showForm = ref(false)
const templateKey = ref('')
const form = reactive({ name: '', role: 'specialist', tools: '', duties: '', reportsTo: '' })
const saving = ref(false)
const formError = ref('')
watch(templateKey, (key) => {
  const t = ROLE_TEMPLATES.find(x => x.key === key) ?? ROLE_TEMPLATES[0]!
  form.name = t.name; form.role = t.role; form.tools = t.tools; form.duties = t.duties
})
function openAdd() {
  formError.value = ''; editingId.value = null; templateKey.value = ''
  form.name = ''; form.role = 'specialist'; form.tools = ''; form.duties = ''
  form.reportsTo = employees.value.find(e => e.role === 'ceo')?.id ?? ''
  showForm.value = true
}
function openEdit(e: Employee) {
  formError.value = ''; editingId.value = e.id; templateKey.value = ''
  form.name = e.label; form.role = e.role; form.tools = e.tools.join('\n'); form.duties = e.duties
  form.reportsTo = e.reportsTo ?? ''
  showForm.value = true
}
async function submitForm() {
  if (!form.name.trim()) { formError.value = 'Name angeben.'; return }
  saving.value = true
  formError.value = ''
  const body = {
    label: form.name.trim(),
    role: form.role,
    duties: form.duties.trim(),
    tools: form.tools.split(/[\n,]/).map((t: string) => t.trim()).filter(Boolean),
    reportsTo: form.reportsTo || null,
  }
  try {
    if (editingId.value) await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents/${editingId.value}`, { method: 'PATCH', body })
    else await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents`, { method: 'POST', body })
    showForm.value = false
    await loadEmployees()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || 'Speichern fehlgeschlagen.' }
  finally { saving.value = false }
}
async function deleteEmployee(e: { id: string }) {
  await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents/${e.id}`, { method: 'DELETE' })
  await loadEmployees()
}
async function toggleEmployee(e: { id: string, enabled: boolean }) {
  await ($fetch as any)(`/api/cockpit/orgs/${orgId.value}/agents/${e.id}`, { method: 'PATCH', body: { enabled: !e.enabled } })
  await loadEmployees()
}

// ── Edit org ──
const showEdit = ref(false)
const editForm = reactive({ name: '', vision: '', budget: 0 })
const savingEdit = ref(false)
function openEditOrg() {
  if (!org.value) return
  editForm.name = org.value.name; editForm.vision = org.value.visionMd; editForm.budget = org.value.budgetMonthlyEur
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
      <UButton to="/companies" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-left">
        Firmen
      </UButton>
      <ViewToggle active="companies" />
    </header>

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <div v-if="loading" class="text-zinc-500 py-20 text-center">
        Lädt …
      </div>
      <UAlert v-else-if="error" color="error" variant="subtle" :title="error" />

      <template v-else-if="org">
        <div class="mb-6">
          <div class="flex items-center justify-between gap-2 mb-3">
            <UBadge :color="providerColor" variant="subtle" size="sm" :ui="{ base: 'gap-1.5' }">
              <UIcon name="i-lucide-cpu" class="size-3.5" /> Claude Session · {{ providerLabel }}
            </UBadge>
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEditOrg">
              Firma bearbeiten
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
          <CompanyChart :employees="employees" :owner-email="ownerEmail" @add="openAdd" @edit="openEdit" @delete="deleteEmployee" @toggle="toggleEmployee" />
        </section>

        <CompanyObjectives v-if="tab === 'ziele'" :org-id="orgId" />
        <CompanyReports v-if="tab === 'reports'" :org-id="orgId" />
        <CompanyCosts v-if="tab === 'kosten'" :org-id="orgId" :budget-eur="org.budgetMonthlyEur" />
      </template>
    </main>

    <!-- Employee form (add + edit) -->
    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter hinzufügen' }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>
          <UFormField v-if="!editingId" label="Vorlage" description="Optional — füllt die Felder vor. Danach frei editierbar.">
            <USelect v-model="templateKey" :items="templateItems" placeholder="Keine Vorlage" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Name">
              <UInput v-model="form.name" placeholder="Mail-Assistent" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
            <UFormField label="Rolle">
              <USelect v-model="form.role" :items="roleItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Vorgesetzter" description="Wem berichtet dieser Mitarbeiter? Bildet die Hierarchie.">
            <USelect v-model="form.reportsTo" :items="supervisorItems" placeholder="Vorgesetzten wählen" class="w-full" />
          </UFormField>
          <UFormField label="Werkzeuge" description="Im Terminal verfügbare Kommandos als Muster, eines pro Zeile — z. B. o365-cli *">
            <UTextarea v-model="form.tools" :rows="2" placeholder="o365-cli *" class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Beschreibung" description="Was tut die Rolle? Read-only — der CEO delegiert danach.">
            <UTextarea v-model="form.duties" :rows="3" placeholder="Triagiert die Inbox read-only und meldet die handlungsrelevanten Mails." class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="saving" @click="submitForm">
              {{ editingId ? 'Speichern' : 'Hinzufügen' }}
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
