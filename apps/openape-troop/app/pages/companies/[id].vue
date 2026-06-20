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
interface Persona { key: string, title: string, role: string }

const org = ref<Org | null>(null)
const members = ref<Member[]>([])
const personas = ref<Persona[]>([])
const loading = ref(true)
const error = ref('')

const ownerEmail = computed(() => (user.value as { sub?: string } | null)?.sub ?? '')
const roleLabel: Record<string, string> = { ceo: 'CEO', teamlead: 'Team-Lead', specialist: 'Specialist', sanierer: 'Controlling', other: 'Mitglied' }

async function loadMembers() { members.value = await ($fetch as any)(`/api/orgs/${orgId.value}/members`) }
async function load() {
  loading.value = true
  error.value = ''
  try {
    org.value = await ($fetch as any)(`/api/orgs/${orgId.value}`)
    await loadMembers()
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

// ── Add member ──
const showAdd = ref(false)
const addForm = reactive({ agentName: '', personaKey: '', agentEmail: '' })
const adding = ref(false)
const addError = ref('')
async function ensurePersonas() { if (!personas.value.length) personas.value = (await ($fetch as any)('/api/personas')).personas }
async function openAdd() { addError.value = ''; addForm.agentName = ''; addForm.personaKey = ''; addForm.agentEmail = ''; await ensurePersonas(); showAdd.value = true }
const personaItems = computed(() => personas.value.map(p => ({ label: `${p.title} · ${roleLabel[p.role] ?? p.role}`, value: p.key })))
async function addMember() {
  if (!addForm.agentName.trim() || !addForm.personaKey) { addError.value = 'Name und Persona wählen.'; return }
  adding.value = true
  addError.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${orgId.value}/members`, { method: 'POST', body: { agent_name: addForm.agentName.trim(), persona: addForm.personaKey, agent_email: addForm.agentEmail.trim() || undefined } })
    showAdd.value = false
    await loadMembers()
  }
  catch (err: any) { addError.value = err?.data?.statusMessage || 'Hinzufügen fehlgeschlagen.' }
  finally { adding.value = false }
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
            <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-user-plus" @click="openAdd">
              Mitglied
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
          <CompanyChart :members="members" :owner-email="ownerEmail" :spawning="spawning" @spawn="spawnMember" />
        </section>

        <CompanyObjectives v-if="tab === 'ziele'" :org-id="orgId" />
        <CompanyReports v-if="tab === 'reports'" :org-id="orgId" />
        <CompanyCosts v-if="tab === 'kosten'" :org-id="orgId" :budget-eur="org.budgetMonthlyEur" />
      </template>
    </main>

    <!-- Add member modal -->
    <UModal v-model:open="showAdd" :ui="{ content: 'sm:max-w-md' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              Mitglied hinzufügen
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" @click="showAdd = false" />
          </div>
          <UFormField label="Name" description="Kurzer Slug, z. B. dm-ceo.">
            <UInput v-model="addForm.agentName" placeholder="dm-ceo" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField label="Persona" description="Bestimmt Rolle + Recipe beim Spawnen.">
            <USelect v-model="addForm.personaKey" :items="personaItems" placeholder="Persona wählen" class="w-full" />
          </UFormField>
          <UFormField label="Agent-E-Mail (optional)" description="Leer lassen, um erst zu planen und später zu spawnen.">
            <UInput v-model="addForm.agentEmail" placeholder="agent+name+domain@id.openape.ai" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UAlert v-if="addError" color="error" variant="subtle" :title="addError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showAdd = false">
              Abbrechen
            </UButton>
            <UButton color="primary" :loading="adding" @click="addMember">
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
