<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Member {
  agentEmail: string
  agentName: string
  role: string
}
interface Persona {
  key: string
  title: string
  role: string
  category: string
  icon: string
  summary: string
  coding: boolean
}
interface PersonaCatalog {
  categories: { key: string, label: string }[]
  personas: Persona[]
}

const props = defineProps<{ orgId: string, existingMembers: Member[], initialPersona?: string }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const CUSTOM = '__custom__'

const NO_REPORTS_TO = '__none__'
const form = ref({ persona: props.initialPersona ?? '', agent_email: '', agent_name: '', role: 'specialist', reports_to_email: NO_REPORTS_TO })
const submitting = ref(false)
const error = ref('')
const nameAutoFilled = ref(true)

const { data: catalog } = await useFetch<PersonaCatalog>('/api/personas')

watch(open, (now) => {
  if (!now) return
  form.value = { persona: props.initialPersona ?? '', agent_email: '', agent_name: '', role: 'specialist', reports_to_email: NO_REPORTS_TO }
  error.value = ''
  nameAutoFilled.value = true
})

// The agent name is also the OS username + troop agent slug, which troop's
// spawn-intent enforces as /^[a-z][a-z0-9-]{0,23}$/. Sanitize live so a name
// like "Ada Lovelace" → "adalovelace" instead of failing with a 400 deep in
// the spawn flow (lowercase, drop invalid chars, must start with a letter, ≤24).
function sanitizeSlug(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '').slice(0, 24)
}
watch(() => form.value.agent_name, (v) => {
  const clean = sanitizeSlug(v)
  if (clean !== v) form.value.agent_name = clean
})

const selectedPersona = computed(() =>
  catalog.value?.personas.find(p => p.key === form.value.persona) ?? null,
)

// The structural chart role: from the chosen persona, or the manual picker
// when running custom (no persona).
const effectiveRole = computed(() =>
  form.value.persona && form.value.persona !== CUSTOM
    ? (selectedPersona.value?.role ?? 'specialist')
    : form.value.role,
)

// Persona dropdown items, grouped by catalog category, with a "custom" escape
// hatch at the top for adding a bare structural role without a persona.
const personaItems = computed(() => {
  const groups: { label: string, value: string, icon?: string }[][] = [[
    { label: t('persona.custom'), value: CUSTOM, icon: 'i-lucide-user-cog' },
  ]]
  for (const cat of catalog.value?.categories ?? []) {
    const members = (catalog.value?.personas ?? []).filter(p => p.category === cat.key)
    if (!members.length) continue
    groups.push(members.map(p => ({ label: p.title, value: p.key, icon: p.icon })))
  }
  return groups
})

// When a persona is picked, suggest a slug from its key (Owner can still edit).
watch(() => form.value.persona, (key) => {
  if (key && key !== CUSTOM && (nameAutoFilled.value || !form.value.agent_name)) {
    form.value.agent_name = sanitizeSlug(key)
    nameAutoFilled.value = true
  }
}, { immediate: true })

// Reka UI's SelectItem rejects an empty-string value, so "none" uses the
// NO_REPORTS_TO sentinel that submit() maps back to an empty reports-to.
const teamleadOptions = computed(() => {
  const tls = props.existingMembers.filter(m => m.role === 'teamlead')
  return [
    { label: t('member.reportsToNone'), value: NO_REPORTS_TO },
    ...tls.map(tl => ({ label: `${tl.agentName} (${tl.agentEmail})`, value: tl.agentEmail })),
  ]
})

const roleOptions = computed(() => [
  { label: t('member.role.ceo'), value: 'ceo' },
  { label: t('member.role.teamlead'), value: 'teamlead' },
  { label: t('member.role.specialist'), value: 'specialist' },
  { label: t('member.role.sanierer'), value: 'sanierer' },
  { label: t('member.role.other'), value: 'other' },
])

async function submit() {
  if (!form.value.agent_name) return
  submitting.value = true
  error.value = ''
  const usingPersona = !!form.value.persona && form.value.persona !== CUSTOM
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/members`, {
      method: 'POST',
      body: {
        // Omit agent_email when blank so the server generates a pending
        // placeholder — Owner can plan the chart before spawning in troop.
        ...(form.value.agent_email.trim() ? { agent_email: form.value.agent_email.trim() } : {}),
        agent_name: form.value.agent_name,
        // A persona pins the recipe AND the structural role; a custom member
        // sends only the role.
        ...(usingPersona ? { persona: form.value.persona } : { role: form.value.role }),
        reports_to_email: form.value.reports_to_email === NO_REPORTS_TO ? null : (form.value.reports_to_email || null),
        status: 'invited',
      },
    })
    emit('saved')
    open.value = false
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('member.error.saveFailed')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md max-h-[92dvh] flex flex-col' }">
    <template #content>
      <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              {{ $t('member.add.title') }}
            </h3>
            <p class="text-xs text-muted mt-1">
              {{ $t('persona.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField :label="$t('persona.field.label')" :description="$t('persona.field.description')" required>
          <USelectMenu
            v-model="form.persona"
            :items="personaItems"
            value-key="value"
            :icon="selectedPersona?.icon || 'i-lucide-users'"
            :placeholder="$t('persona.field.placeholder')"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </UFormField>

        <UAlert
          v-if="selectedPersona"
          color="primary"
          variant="subtle"
          :icon="selectedPersona.icon"
          :title="selectedPersona.title"
        >
          <template #description>
            <div class="space-y-1">
              <p>{{ selectedPersona.summary }}</p>
              <div class="flex flex-wrap gap-1.5 pt-1">
                <UBadge size="xs" variant="soft" color="neutral">
                  {{ $t('persona.chartRole') }}: {{ $t(`member.role.${selectedPersona.role}`) }}
                </UBadge>
                <UBadge size="xs" variant="soft" :color="selectedPersona.coding ? 'success' : 'neutral'">
                  {{ selectedPersona.coding ? $t('persona.tag.coding') : $t('persona.tag.knowledge') }}
                </UBadge>
                <UBadge size="xs" variant="soft" color="info">
                  {{ $t('persona.tag.autonomous') }}
                </UBadge>
              </div>
            </div>
          </template>
        </UAlert>

        <UFormField v-if="form.persona === CUSTOM" :label="$t('member.field.role')" required>
          <USelect v-model="form.role" :items="roleOptions" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField :label="$t('member.field.agentName.label')" :description="$t('member.field.agentName.description')" required>
          <UInput v-model="form.agent_name" placeholder="alice" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField :label="$t('member.field.agentEmail.label')" :description="$t('member.field.agentEmail.descriptionOptional')">
          <UInput v-model="form.agent_email" :placeholder="$t('member.field.agentEmail.placeholderOptional')" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UAlert
          v-if="!form.agent_email.trim()"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :title="$t('member.field.agentEmail.pendingTitle')"
          :description="$t('member.field.agentEmail.pendingDescription')"
        />

        <UFormField v-if="effectiveRole === 'specialist'" :label="$t('member.field.reportsTo.label')" :description="$t('member.field.reportsTo.description')">
          <USelect v-model="form.reports_to_email" :items="teamleadOptions" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />
      </div>

      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" :disabled="submitting" @click="open = false">
          {{ $t('common.cancel') }}
        </UButton>
        <UButton color="primary" :loading="submitting" :disabled="!form.agent_name" @click="submit">
          {{ $t('member.add.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
