<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Member {
  agentEmail: string
  agentName: string
  role: string
}

const props = defineProps<{ orgId: string, existingMembers: Member[] }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const form = ref({ agent_email: '', agent_name: '', role: 'specialist', reports_to_email: '' })
const submitting = ref(false)
const error = ref('')

watch(open, (now) => {
  if (!now) return
  form.value = { agent_email: '', agent_name: '', role: 'specialist', reports_to_email: '' }
  error.value = ''
})

// Only Teamleads make sense as a parent. CEO + Sanierer report to Owner;
// the Owner isn't a row in members.
const teamleadOptions = computed(() => {
  const tls = props.existingMembers.filter(m => m.role === 'teamlead')
  return [
    { label: t('member.reportsToNone'), value: '' },
    ...tls.map(t => ({ label: `${t.agentName} (${t.agentEmail})`, value: t.agentEmail })),
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
  if (!form.value.agent_email || !form.value.agent_name) return
  submitting.value = true
  error.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/members`, {
      method: 'POST',
      body: {
        agent_email: form.value.agent_email,
        agent_name: form.value.agent_name,
        role: form.value.role,
        reports_to_email: form.value.reports_to_email || null,
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
              {{ $t('member.add.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField :label="$t('member.field.role')" required>
          <USelect v-model="form.role" :items="roleOptions" />
        </UFormField>

        <UFormField :label="$t('member.field.agentName.label')" :description="$t('member.field.agentName.description')" required>
          <UInput v-model="form.agent_name" placeholder="alice" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField :label="$t('member.field.agentEmail.label')" :description="$t('member.field.agentEmail.description')" required>
          <UInput v-model="form.agent_email" placeholder="agent+alice+example.com@id.openape.ai" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField v-if="form.role === 'specialist'" :label="$t('member.field.reportsTo.label')" :description="$t('member.field.reportsTo.description')">
          <USelect v-model="form.reports_to_email" :items="teamleadOptions" />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />
      </div>

      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" :disabled="submitting" @click="open = false">
          {{ $t('common.cancel') }}
        </UButton>
        <UButton color="primary" :loading="submitting" :disabled="!form.agent_email || !form.agent_name" @click="submit">
          {{ $t('member.add.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
