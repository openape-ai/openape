<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

// Skill library — owner-level, reusable procedures (e.g. tool-skills like o365-cli/
// gmail-cli) assignable to agents across ALL companies. Distinct from a company's
// own Skills tab (org-scoped).
const { t } = useI18n()
useSeoMeta({ title: () => t('skillsLibrary.tabTitle') })

const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Skill { id: string, name: string, description: string, prompt: string, assignedTo: string[], updatedAt: number }
interface Agent { id: string, label: string, role: string, orgId: string, orgName: string }

const items = ref<Skill[]>([])
const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')
const busy = reactive<Record<string, boolean>>({})

// Assignment targets: the operators of all companies ('ceo') plus every agent,
// grouped by company for the editor.
const agentsByOrg = computed(() => {
  const groups = new Map<string, Agent[]>()
  for (const a of agents.value) {
    if (a.role === 'ceo') continue
    if (!groups.has(a.orgName)) groups.set(a.orgName, [])
    groups.get(a.orgName)!.push(a)
  }
  return Array.from(groups.entries(), ([orgName, list]) => ({ orgName, list }))
})
const labelFor = (target: string) => target === 'ceo' ? t('skillsLibrary.ceoTarget') : agents.value.find(a => a.id === target)?.label ?? target

async function load() {
  loading.value = true
  error.value = ''
  try {
    ;[items.value, agents.value] = await Promise.all([
      apiFetch<Skill[]>('/api/cockpit/skills'),
      apiFetch<Agent[]>('/api/cockpit/agents'),
    ])
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('skillsLibrary.error.loadFailed')
  }
  finally { loading.value = false }
}

const showForm = ref(false)
const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const form = reactive({ name: '', description: '', prompt: '', assignedTo: [] as string[] })

function openAdd() {
  editingId.value = ''
  Object.assign(form, { name: '', description: '', prompt: '', assignedTo: [] })
  formError.value = ''
  showForm.value = true
}
function openEdit(s: Skill) {
  editingId.value = s.id
  Object.assign(form, { name: s.name, description: s.description, prompt: s.prompt, assignedTo: [...s.assignedTo] })
  formError.value = ''
  showForm.value = true
}
function toggleTarget(value: string) {
  const i = form.assignedTo.indexOf(value)
  if (i === -1) form.assignedTo.push(value)
  else form.assignedTo.splice(i, 1)
}

async function submit() {
  if (!form.name.trim()) { formError.value = t('common.required', { field: t('skillsLibrary.form.name.label') }); return }
  saving.value = true
  formError.value = ''
  const body = { name: form.name.trim(), description: form.description.trim(), prompt: form.prompt, assignedTo: form.assignedTo }
  try {
    if (editingId.value) await apiFetch(`/api/cockpit/skills/${editingId.value}`, { method: 'PATCH', body })
    else await apiFetch('/api/cockpit/skills', { method: 'POST', body })
    showForm.value = false
    await load()
  }
  catch (err: any) { formError.value = err?.data?.statusMessage || t('common.error.saveFailed') }
  finally { saving.value = false }
}
async function remove(s: Skill) {
  busy[s.id] = true
  try {
    await apiFetch(`/api/cockpit/skills/${s.id}`, { method: 'DELETE' })
    await load()
  }
  finally { busy[s.id] = false }
}

// Load only once a user is known. A top-level `await load()` crashed SSR for
// logged-out visitors: its 401 branch calls navigateTo after several await
// boundaries, where the Nuxt instance is already gone (500 on /skills).
watch(user, (u) => { if (u) void load() }, { immediate: true })
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <AppHeader active="skills" :show-logout="!!user" @logout="logout">
      <template #actions>
        <UButton color="primary" size="sm" icon="i-lucide-plus" :aria-label="$t('skillsLibrary.form.titleNew')" @click="openAdd">
          <span class="hidden sm:inline">{{ $t('skillsLibrary.newButton') }}</span>
        </UButton>
      </template>
    </AppHeader>

    <main class="max-w-4xl mx-auto px-4 sm:px-8 py-8">
      <InlineLogin v-if="!user" :hint="$t('common.loginHint', { what: $t('skillsLibrary.loginWhat') })" />
      <template v-else>
        <h2 class="text-2xl font-bold mb-1">
          {{ $t('skillsLibrary.heading') }}
        </h2>
        <p class="text-sm text-zinc-500 mb-6">
          {{ $t('skillsLibrary.subheading') }}
        </p>

        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />
        <div v-if="loading" class="text-zinc-500 py-10 text-center">
          {{ $t('common.loading') }}
        </div>
        <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
          {{ $t('skillsLibrary.empty') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="s in items"
            :key="s.id"
            class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
            @click="openEdit(s)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium truncate">{{ s.name || $t('common.unnamed') }}</span>
                  <UBadge v-for="target in s.assignedTo" :key="target" :color="target === 'ceo' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                    {{ labelFor(target) }}
                  </UBadge>
                  <UBadge v-if="!s.assignedTo.length" color="warning" variant="subtle" size="xs">
                    {{ $t('common.unassigned') }}
                  </UBadge>
                </div>
                <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
                  {{ s.description }}
                </p>
              </div>
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :loading="busy[s.id]" :aria-label="$t('skillsLibrary.deleteAria')" @click.stop="remove(s)" />
            </div>
          </div>
        </div>
      </template>
    </main>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? $t('skillsLibrary.form.titleEdit') : $t('skillsLibrary.form.titleNew') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :aria-label="$t('common.close')" @click="showForm = false" />
          </div>
          <UFormField :label="$t('skillsLibrary.form.name.label')" :description="$t('common.field.shortIdHint')">
            <UInput v-model="form.name" placeholder="o365-cli" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('skillsLibrary.form.description.label')" :description="$t('skillsLibrary.form.description.hint')">
            <UInput v-model="form.description" :placeholder="$t('skillsLibrary.form.description.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('common.field.promptLabel')" :description="$t('skillsLibrary.form.prompt.hint')">
            <UTextarea v-model="form.prompt" :rows="10" :placeholder="$t('skillsLibrary.form.prompt.placeholder')" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('skillsLibrary.form.assignedTo.label')" :description="$t('skillsLibrary.form.assignedTo.hint')">
            <div class="space-y-3 pt-1">
              <label class="flex items-center gap-2 cursor-pointer text-sm">
                <UCheckbox :model-value="form.assignedTo.includes('ceo')" @update:model-value="toggleTarget('ceo')" />
                {{ $t('skillsLibrary.ceoTarget') }}
              </label>
              <div v-for="grp in agentsByOrg" :key="grp.orgName">
                <div class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  {{ grp.orgName }}
                </div>
                <div class="flex flex-wrap gap-3">
                  <label v-for="a in grp.list" :key="a.id" class="flex items-center gap-2 cursor-pointer text-sm">
                    <UCheckbox :model-value="form.assignedTo.includes(a.id)" @update:model-value="toggleTarget(a.id)" />
                    {{ a.label }}
                  </label>
                </div>
              </div>
            </div>
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="saving" @click="submit">
              {{ editingId ? $t('common.save') : $t('common.add') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
