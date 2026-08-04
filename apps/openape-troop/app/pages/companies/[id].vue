<script setup lang="ts">
import type { Employee } from '~/components/company/OrgNode.vue'
import { classifyHeuristic } from '@openape/prompt-injection-detector/heuristic'
import { computed, reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Company detail — its employees (the whole hierarchy) + business tabs. troop
// defines the workforce; a provider (Claude session today, a nest later) runs it.
const route = useRoute()
const orgId = computed(() => String(route.params.id))
const { t, te } = useI18n()
const { fmtRelative } = useRelativeTime()
useSeoMeta({ title: () => t('companyDetail.tabTitle') })

const { user, fetchUser } = useOpenApeAuth()
await fetchUser()

interface Org { id: string, name: string, visionMd: string, budgetMonthlyEur: number, vars: Record<string, unknown> }

const org = ref<Org | null>(null)
const employees = ref<Employee[]>([])
const loading = ref(true)
const error = ref('')
const ownerEmail = computed(() => (user.value as { sub?: string } | null)?.sub ?? '')

async function loadEmployees() { employees.value = await apiFetch(`/api/cockpit/orgs/${orgId.value}/agents`) }

// YOLO-Drift: was der Worker zuletzt als Operator-Policy gemeldet hat vs. die
// heutigen Rollen-tools. Fehlt der Report (alter Worker), zeigen wir nichts an.
interface YoloSyncView {
  state: { opEmail: string, mode: string, patternCount: number, ok: boolean, error: string, syncedAt: number, reportedAt: number } | null
  added?: string[]
  removed?: string[]
  inSync?: boolean
}
const yoloSync = ref<YoloSyncView | null>(null)
async function loadYoloSync() {
  try { yoloSync.value = await apiFetch(`/api/cockpit/orgs/${orgId.value}/yolo-sync`) }
  catch { yoloSync.value = null }
}
const driftDescription = computed(() => {
  const s = yoloSync.value
  if (!s?.state) return ''
  const changes = [...(s.added ?? []).map(tool => `+ ${tool}`), ...(s.removed ?? []).map(tool => `− ${tool}`)].join(' · ')
  return t('companyDetail.policySync.driftDescription', { when: fmtRelative(s.state.syncedAt), changes })
})

// Provider status — the agentic provider running this company (today: the Claude
// session loop). Reuses the cockpit presence (active/idle/working/offline).
const providerMode = ref<'active' | 'idle' | 'working' | 'offline'>('offline')
const providerLabel = computed(() => t(`companyDetail.provider.${providerMode.value}`))
const providerColor = computed(() => ({ active: 'success', idle: 'info', working: 'warning', offline: 'neutral' } as const)[providerMode.value])
async function loadProvider() {
  try { providerMode.value = (await apiFetch<{ mode: 'active' | 'idle' | 'working' | 'offline' }>('/api/cockpit/status')).mode }
  catch { providerMode.value = 'offline' }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    org.value = await apiFetch(`/api/orgs/${orgId.value}`)
    await Promise.all([loadEmployees(), loadProvider(), loadYoloSync()])
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('companyDetail.error.loadFailed')
  }
  finally { loading.value = false }
}

const tab = ref<'firma' | 'ziele' | 'memory' | 'skills' | 'automatik' | 'reports'>('firma')
const TABS = [
  { key: 'firma', labelKey: 'companyDetail.tab.company', icon: 'i-lucide-building-2' },
  { key: 'ziele', labelKey: 'companyDetail.tab.objectives', icon: 'i-lucide-target' },
  { key: 'memory', labelKey: 'companyDetail.tab.memory', icon: 'i-lucide-brain' },
  { key: 'skills', labelKey: 'companyDetail.tab.skills', icon: 'i-lucide-wand-2' },
  { key: 'automatik', labelKey: 'companyDetail.tab.automation', icon: 'i-lucide-alarm-clock' },
  { key: 'reports', labelKey: 'companyDetail.tab.reports', icon: 'i-lucide-file-text' },
] as const

// ── Employee form (add + edit) ──
// An optional template pre-fills Name/Rolle/Werkzeuge/Beschreibung, then edit
// freely. „Werkzeuge" = wildcard command patterns (e.g. `o365-cli *`).
// The prefilled name/duties/tools stay as authored: they are persisted and end
// up in the agent's own prompt. Only the picker label is UI text.
interface RoleTemplate { key: string, name: string, role: string, tools: string, duties: string, procedure?: string }
const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: '', name: '', role: 'specialist', tools: '', duties: '' },
  { key: 'programmierer', name: 'Programmierer', role: 'specialist', tools: '*', duties: 'Implementiert Sprint-Todos in einem Worktree, verifiziert lokal und pusht einen PR. Merged nie selbst.', procedure: '' },
  { key: 'ceo', name: 'Operator', role: 'ceo', tools: 'ape-tasks *', duties: 'Führt die Firma, kommuniziert mit dem Owner und skaliert das Team hoch/runter. Verdichtet die Meldungen der Mitarbeiter zu Handlungsbedarf.' },
  { key: 'pm', name: 'Projektmanager', role: 'teamlead', tools: 'ape-tasks *', duties: 'Pflegt Backlog/Aufgaben, plant, hält Termine/Blocker sichtbar.' },
  { key: 'mail-m365', name: 'Mail-Assistent', role: 'specialist', tools: 'o365-cli *\npdftotext *', duties: 'Triagiert die Inbox read-only, meldet die handlungsrelevanten Mails und liest Anhänge (PDF) auf Nachfrage. Sendet/verschiebt/löscht NIE.' },
  { key: 'mail-gmail', name: 'Mail-Assistent', role: 'specialist', tools: 'gmail-cli *', duties: 'Triagiert die Gmail-Inbox read-only und meldet die handlungsrelevanten Mails. Sendet/verschiebt/löscht NIE.' },
  { key: 'buchhaltung', name: 'Buchhaltung', role: 'specialist', tools: 'o365-cli *\npdftotext *', duties: 'Sichtet Belege/Eingangsrechnungen read-only, bereitet Ablage nach Bill-To-Regeln vor. Bucht/zahlt nichts selbst — legt Vorschläge vor.' },
  { key: 'social', name: 'Social Media', role: 'specialist', tools: '', duties: 'Entwirft LinkedIn/X-Posts (blog-first) aus delta-mind.at-Inhalten. Postet nichts selbst — legt Entwürfe vor.' },
  { key: 'docs', name: 'Dokument-Leser', role: 'specialist', tools: 'pdftotext *\npdfinfo *', duties: 'Liest PDF-/Dokument-Inhalte read-only und fasst die relevanten Fakten/Zahlen zusammen.' },
]
const templateItems = computed(() => ROLE_TEMPLATES.map(tpl => ({ label: t(`companyDetail.template.${tpl.key || 'none'}`), value: tpl.key })))
const ROLE_OPTIONS = ['ceo', 'teamlead', 'specialist']
const roleItems = computed(() => ROLE_OPTIONS.map(role => ({ label: t(`common.role.${role}`), value: role })))
// A role the catalog does not know still has to name itself in the picker.
function roleLabel(role: string): string {
  const key = `common.role.${role}`
  return te(key) ? t(key) : role
}
const editingId = ref<string | null>(null)
const supervisorItems = computed(() => [
  { label: t('companyDetail.employee.supervisor.owner'), value: '' },
  ...employees.value.filter(e => e.id !== editingId.value).map(e => ({ label: `${e.label} · ${roleLabel(e.role)}`, value: e.id })),
])
const showForm = ref(false)
const templateKey = ref('')
const form = reactive({ name: '', role: 'specialist', tools: '', duties: '', procedure: '', varsText: '{}', reportsTo: '' })
const saving = ref(false)
const formError = ref('')

// `vars` is hand-written JSON. Broken JSON must block the save with a visible
// message — never fall back to {} and silently drop the operator's facts.
function parseVarsText(text: string): { vars: Record<string, unknown> } | { error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { vars: {} }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) }
  catch (err) { return { error: t('companyDetail.error.invalidJson', { message: (err as Error).message }) } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: t('companyDetail.error.varsNotObject') }
  return { vars: parsed as Record<string, unknown> }
}
const varsError = computed(() => {
  const result = parseVarsText(form.varsText)
  return 'error' in result ? result.error : ''
})

// Live prompt-injection score of the procedure text — same pure function the
// server persists on save, so the badge always matches the stored score.
// A visible signal, never a gate (the owner may author flagged instructions).
const procedureRisk = computed(() => {
  const text = form.procedure.trim()
  if (!text) return null
  const { score, reason } = classifyHeuristic({ text, sender: { email: ownerEmail.value, isOwner: true } })
  const level = score >= 0.7 ? 'error' : score >= 0.3 ? 'warning' : 'success'
  return { score, reason: reason ?? '', level: level as 'error' | 'warning' | 'success' }
})
const procedureRiskLabel = computed(() => {
  const risk = procedureRisk.value
  if (!risk) return ''
  const score = risk.score.toFixed(2)
  return risk.reason
    ? t('companyDetail.employee.risk.badgeWithReason', { score, reason: risk.reason })
    : t('companyDetail.employee.risk.badge', { score })
})

watch(templateKey, (key) => {
  const tpl = ROLE_TEMPLATES.find(x => x.key === key) ?? ROLE_TEMPLATES[0]!
  form.name = tpl.name; form.role = tpl.role; form.tools = tpl.tools; form.duties = tpl.duties; form.procedure = tpl.procedure ?? ''
})
function openAdd() {
  formError.value = ''; editingId.value = null; templateKey.value = ''
  form.name = ''; form.role = 'specialist'; form.tools = ''; form.duties = ''; form.procedure = ''; form.varsText = '{}'
  form.reportsTo = employees.value.find(e => e.role === 'ceo')?.id ?? ''
  showForm.value = true
}
function openEdit(e: Employee) {
  formError.value = ''; editingId.value = e.id; templateKey.value = ''
  form.name = e.label; form.role = e.role; form.tools = e.tools.join('\n'); form.duties = e.duties
  form.procedure = e.procedure; form.varsText = JSON.stringify(e.vars ?? {}, null, 2)
  form.reportsTo = e.reportsTo ?? ''
  showForm.value = true
}
async function submitForm() {
  if (!form.name.trim()) { formError.value = t('common.required', { field: t('companyDetail.employee.name.label') }); return }
  const parsedVars = parseVarsText(form.varsText)
  if ('error' in parsedVars) { formError.value = parsedVars.error; return }
  saving.value = true
  formError.value = ''
  const body = {
    label: form.name.trim(),
    role: form.role,
    duties: form.duties.trim(),
    procedure: form.procedure.trim(),
    vars: parsedVars.vars,
    tools: form.tools.split(/[\n,]/).map((tool: string) => tool.trim()).filter(Boolean),
    reportsTo: form.reportsTo || null,
  }
  try {
    if (editingId.value) await apiFetch(`/api/cockpit/orgs/${orgId.value}/agents/${editingId.value}`, { method: 'PATCH', body })
    else await apiFetch(`/api/cockpit/orgs/${orgId.value}/agents`, { method: 'POST', body })
    showForm.value = false
    await Promise.all([loadEmployees(), loadYoloSync()])
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || t('common.error.saveFailed') }
  finally { saving.value = false }
}
async function deleteEmployee(e: { id: string }) {
  await apiFetch(`/api/cockpit/orgs/${orgId.value}/agents/${e.id}`, { method: 'DELETE' })
  await Promise.all([loadEmployees(), loadYoloSync()])
}
async function toggleEmployee(e: { id: string, enabled: boolean }) {
  await apiFetch(`/api/cockpit/orgs/${orgId.value}/agents/${e.id}`, { method: 'PATCH', body: { enabled: !e.enabled } })
  await Promise.all([loadEmployees(), loadYoloSync()])
}

// ── Edit org ──
const showEdit = ref(false)
const editForm = reactive({ name: '', vision: '', budget: 0, varsText: '{}' })
const savingEdit = ref(false)
const editVarsError = computed(() => {
  const result = parseVarsText(editForm.varsText)
  return 'error' in result ? result.error : ''
})
const saveOrgError = ref('')
function openEditOrg() {
  if (!org.value) return
  editForm.name = org.value.name; editForm.vision = org.value.visionMd; editForm.budget = org.value.budgetMonthlyEur
  editForm.varsText = JSON.stringify(org.value.vars ?? {}, null, 2)
  saveOrgError.value = ''
  showEdit.value = true
}
async function saveOrg() {
  const parsedVars = parseVarsText(editForm.varsText)
  if ('error' in parsedVars) { saveOrgError.value = parsedVars.error; return }
  savingEdit.value = true
  saveOrgError.value = ''
  try {
    await apiFetch(`/api/orgs/${orgId.value}`, { method: 'PATCH', body: { name: editForm.name.trim(), vision_md: editForm.vision.trim(), budget_monthly_eur: editForm.budget, vars: parsedVars.vars } })
    showEdit.value = false
    await load()
  }
  catch (err: any) { saveOrgError.value = err?.data?.statusMessage || t('common.error.saveFailed') }
  finally { savingEdit.value = false }
}

watch(user, (u) => { if (u) load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader :back="{ to: '/companies', label: $t('companyDetail.backToCompanies') }" active="companies" :show-logout="false" />

    <main class="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <div v-if="loading" class="text-zinc-500 py-20 text-center">
        {{ $t('common.loading') }}
      </div>
      <UAlert v-else-if="error" color="error" variant="subtle" :title="error" />

      <template v-else-if="org">
        <div class="mb-6">
          <div class="flex items-center justify-between gap-2 mb-3">
            <UBadge :color="providerColor" variant="subtle" size="sm" :ui="{ base: 'gap-1.5' }">
              <UIcon name="i-lucide-cpu" class="size-3.5" /> {{ $t('companyDetail.provider.session') }} · {{ providerLabel }}
            </UBadge>
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEditOrg">
              {{ $t('companyDetail.editOrg.title') }}
            </UButton>
          </div>
          <h2 class="text-3xl font-bold tracking-tight">
            {{ org.name }}
          </h2>
          <MarkdownText v-if="org.visionMd" :content="org.visionMd" class="mt-2 text-zinc-400" />
        </div>

        <div class="flex gap-1 border-b border-zinc-800/80 mb-8 overflow-x-auto">
          <button
            v-for="tabItem in TABS"
            :key="tabItem.key"
            class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 shrink-0"
            :class="tab === tabItem.key ? 'border-primary-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'"
            :aria-label="$t(tabItem.labelKey)"
            @click="tab = tabItem.key"
          >
            <UIcon :name="tabItem.icon" class="size-4" />
            <span :class="tab === tabItem.key ? '' : 'hidden sm:inline'">{{ $t(tabItem.labelKey) }}</span>
          </button>
        </div>

        <section v-if="tab === 'firma'" class="mb-10">
          <template v-if="yoloSync?.state">
            <UAlert
              v-if="!yoloSync.state.ok"
              color="error"
              variant="subtle"
              icon="i-lucide-shield-alert"
              :title="$t('companyDetail.policySync.failedTitle')"
              :description="$t('companyDetail.policySync.failedDescription', { when: fmtRelative(yoloSync.state.reportedAt), error: yoloSync.state.error })"
              class="mb-4"
            />
            <UAlert
              v-else-if="!yoloSync.inSync"
              color="warning"
              variant="subtle"
              icon="i-lucide-shield-alert"
              :title="$t('companyDetail.policySync.driftTitle')"
              :description="driftDescription"
              class="mb-4"
            />
            <div v-else class="mb-4 flex items-center gap-2 text-xs text-zinc-500">
              <UIcon name="i-lucide-shield-check" class="size-4 text-success-500" />
              <span>{{ $t('companyDetail.policySync.upToDate', { mode: yoloSync.state.mode, patterns: yoloSync.state.patternCount, when: fmtRelative(yoloSync.state.syncedAt) }) }}</span>
            </div>
          </template>
          <CompanyChart :employees="employees" :owner-email="ownerEmail" @add="openAdd" @edit="openEdit" @delete="deleteEmployee" @toggle="toggleEmployee" />
        </section>

        <CompanyObjectives v-if="tab === 'ziele'" :org-id="orgId" />
        <CompanyMemory v-if="tab === 'memory'" :org-id="orgId" />
        <CompanySkills v-if="tab === 'skills'" :org-id="orgId" :agents="employees" />
        <CompanyAutomations v-if="tab === 'automatik'" :org-id="orgId" />
        <CompanyReports v-if="tab === 'reports'" :org-id="orgId" />
      </template>
    </main>

    <!-- Employee form (add + edit) -->
    <!-- The procedure textarea makes this form taller than a laptop viewport;
         without the cap the save button and the vars error scroll off-screen. -->
    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? $t('companyDetail.employee.titleEdit') : $t('companyDetail.employee.titleAdd') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showForm = false" />
          </div>
          <UFormField v-if="!editingId" :label="$t('companyDetail.employee.template.label')" :description="$t('companyDetail.employee.template.description')">
            <USelect v-model="templateKey" :items="templateItems" :placeholder="$t('companyDetail.employee.template.placeholder')" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="$t('companyDetail.employee.name.label')">
              <UInput v-model="form.name" :placeholder="$t('companyDetail.employee.name.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
            <UFormField :label="$t('companyDetail.employee.role.label')">
              <USelect v-model="form.role" :items="roleItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="$t('companyDetail.employee.supervisor.label')" :description="$t('companyDetail.employee.supervisor.description')">
            <USelect v-model="form.reportsTo" :items="supervisorItems" :placeholder="$t('companyDetail.employee.supervisor.placeholder')" class="w-full" />
          </UFormField>
          <UFormField :label="$t('companyDetail.employee.tools.label')" :description="$t('companyDetail.employee.tools.description')">
            <UTextarea v-model="form.tools" :rows="2" placeholder="o365-cli *" class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.employee.duties.label')" :description="$t('companyDetail.employee.duties.description')">
            <UTextarea v-model="form.duties" :rows="2" :placeholder="$t('companyDetail.employee.duties.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.employee.procedure.label')" :description="$t('companyDetail.employee.procedure.description')">
            <template #hint>
              <UBadge
                v-if="procedureRisk"
                :color="procedureRisk.level"
                variant="subtle"
                size="sm"
                :title="procedureRisk.reason || $t('companyDetail.employee.risk.none')"
              >
                {{ procedureRiskLabel }}
              </UBadge>
            </template>
            <UTextarea v-model="form.procedure" :rows="12" :placeholder="$t('companyDetail.employee.procedure.placeholder')" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.employee.vars.label')" :description="$t('companyDetail.employee.vars.description')">
            <UTextarea v-model="form.varsText" :rows="4" placeholder="{ &quot;boardUser&quot;: 254 }" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="varsError" color="warning" variant="subtle" :title="varsError" />
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="saving" :disabled="!!varsError" @click="submitForm">
              {{ editingId ? $t('common.save') : $t('common.add') }}
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
              {{ $t('companyDetail.editOrg.title') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showEdit = false" />
          </div>
          <UFormField :label="$t('companyDetail.editOrg.nameLabel')">
            <UInput v-model="editForm.name" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.editOrg.visionLabel')" :description="$t('companyDetail.editOrg.visionDescription')">
            <UTextarea v-model="editForm.vision" :rows="5" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.editOrg.budgetLabel')">
            <UInput v-model.number="editForm.budget" type="number" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('companyDetail.editOrg.varsLabel')" :description="$t('companyDetail.editOrg.varsDescription')">
            <UTextarea v-model="editForm.varsText" :rows="5" placeholder="{ &quot;project&quot;: 125 }" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="editVarsError" color="warning" variant="subtle" :title="editVarsError" />
          <UAlert v-if="saveOrgError" color="error" variant="subtle" :title="saveOrgError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showEdit = false">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="savingEdit" :disabled="!!editVarsError" @click="saveOrg">
              {{ $t('common.save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
