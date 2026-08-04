<script setup lang="ts">
import { ref, watch } from 'vue'

// Skills — per-agent SKILL.md catalog. Each row → one `<name>/SKILL.md` on the
// agent host after sync. CRUD via dedicated endpoints under
// /api/agents/[name]/skills/.
interface Skill {
  agentEmail: string
  name: string
  description: string
  body: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

const props = defineProps<{ agentName: string }>()

const { t } = useI18n()

const skills = ref<Skill[]>([])
const skillsError = ref('')
const skillEditor = ref<{ open: boolean, isNew: boolean, name: string, description: string, body: string, enabled: boolean }>({
  open: false,
  isNew: true,
  name: '',
  description: '',
  body: '',
  enabled: true,
})
const skillSaving = ref(false)

async function loadSkills() {
  if (!props.agentName) return
  skillsError.value = ''
  try { skills.value = await apiFetch<Skill[]>(`/api/agents/${props.agentName}/skills`) }
  catch (err: any) { skillsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.skills.error.loadFailed') }
}
watch(() => props.agentName, loadSkills, { immediate: true })

function openCreateSkill() {
  skillEditor.value = { open: true, isNew: true, name: '', description: '', body: '', enabled: true }
}

function openEditSkill(s: Skill) {
  skillEditor.value = { open: true, isNew: false, name: s.name, description: s.description, body: s.body, enabled: s.enabled }
}

async function saveSkill() {
  if (!props.agentName) return
  skillSaving.value = true
  skillsError.value = ''
  try {
    await apiFetch(`/api/agents/${props.agentName}/skills`, {
      method: 'PUT',
      body: {
        name: skillEditor.value.name,
        description: skillEditor.value.description,
        body: skillEditor.value.body,
        enabled: skillEditor.value.enabled,
      },
    })
    skillEditor.value.open = false
    await loadSkills()
  }
  catch (err: any) {
    skillsError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    skillSaving.value = false
  }
}

async function deleteSkill(name: string) {
  if (!props.agentName) return
  if (!confirm(t('agentDetail.skills.confirmDelete', { name }))) return
  try {
    await apiFetch(`/api/agents/${props.agentName}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    await loadSkills()
  }
  catch (err: any) {
    skillsError.value = err?.data?.statusMessage || err?.message || t('common.error.deleteFailed')
  }
}
</script>

<template>
  <div>
    <UCard :ui="{ body: 'p-0' }">
      <details class="group">
        <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-book-open" class="text-muted size-4" />
            <span class="font-medium">{{ $t('agentDetail.skills.title') }}</span>
            <UBadge color="neutral" variant="subtle" size="xs">
              {{ skills.length }}
            </UBadge>
          </div>
          <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div class="border-t border-(--ui-border)">
          <div class="flex items-start justify-between gap-3 px-4 py-3">
            <p class="text-xs text-muted">
              {{ $t('agentDetail.skills.hint') }}
            </p>
            <UButton color="primary" size="sm" icon="i-lucide-plus" :ui="{ base: 'shrink-0' }" @click="openCreateSkill">
              {{ $t('agentDetail.skills.newButton') }}
            </UButton>
          </div>
          <UAlert v-if="skillsError" color="error" :title="skillsError" class="m-4" />
          <i18n-t v-if="skills.length === 0" keypath="agentDetail.skills.empty" tag="div" class="px-4 pb-6 pt-2 text-center text-muted text-sm">
            <template #pkg>
              <code class="text-zinc-300">@openape/ape-agent</code>
            </template>
          </i18n-t>
          <ul v-else class="divide-y divide-(--ui-border)">
            <li v-for="s in skills" :key="s.name">
              <button
                type="button"
                class="w-full text-left px-4 py-3 active:bg-zinc-900 transition-colors flex items-start gap-3"
                @click="openEditSkill(s)"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap mb-1">
                    <span class="font-medium text-base">{{ s.name }}</span>
                    <UBadge v-if="!s.enabled" color="neutral" variant="subtle" size="xs">
                      {{ $t('common.badge.disabled') }}
                    </UBadge>
                  </div>
                  <div class="text-xs text-muted line-clamp-2">
                    {{ s.description }}
                  </div>
                </div>
                <UButton
                  size="sm"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="$t('agentDetail.skills.deleteAria')"
                  @click.stop="deleteSkill(s.name)"
                />
              </button>
            </li>
          </ul>
        </div>
      </details>
    </UCard>

    <!-- Skill editor modal -->
    <UModal v-model:open="skillEditor.open">
      <template #content>
        <div class="p-5 space-y-4">
          <h3 class="text-lg font-semibold">
            {{ skillEditor.isNew ? $t('agentDetail.skills.editor.titleNew') : $t('agentDetail.skills.editor.titleEdit', { name: skillEditor.name }) }}
          </h3>
          <UFormField :label="$t('agentDetail.skills.editor.name.label')" :description="skillEditor.isNew ? $t('agentDetail.skills.editor.name.descriptionNew') : $t('agentDetail.skills.editor.name.descriptionImmutable')">
            <UInput v-model="skillEditor.name" :disabled="!skillEditor.isNew || skillSaving" placeholder="iurio" />
          </UFormField>
          <UFormField :label="$t('agentDetail.skills.editor.description.label')" :description="$t('agentDetail.skills.editor.description.description')">
            <UInput v-model="skillEditor.description" :disabled="skillSaving" :placeholder="$t('agentDetail.skills.editor.description.placeholder')" />
          </UFormField>
          <UFormField :label="$t('agentDetail.skills.editor.body.label')" :description="$t('agentDetail.skills.editor.body.description')">
            <UTextarea v-model="skillEditor.body" :rows="14" :disabled="skillSaving" :placeholder="$t('agentDetail.skills.editor.body.placeholder')" />
          </UFormField>
          <UFormField :label="$t('agentDetail.skills.editor.enabled.label')" :description="$t('agentDetail.skills.editor.enabled.description')">
            <USwitch v-model="skillEditor.enabled" :disabled="skillSaving" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" :disabled="skillSaving" @click="skillEditor.open = false">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="skillSaving" @click="saveSkill">
              {{ $t('common.save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
