<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ orgId: string, placeholderEmail: string | null }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

// Owner pastes the real DDISA email of the agent they just spawned
// in troop. The PATCH endpoint handles the PK swap server-side
// (delete placeholder row, insert under new email) and flips the
// status to 'active' since the agent now exists.
const newEmail = ref('')
const submitting = ref(false)
const error = ref('')

watch(open, (now) => {
  if (!now) return
  newEmail.value = ''
  error.value = ''
})

async function submit() {
  const trimmed = newEmail.value.trim()
  if (!trimmed || !props.placeholderEmail) return
  submitting.value = true
  error.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/members/${encodeURIComponent(props.placeholderEmail)}`, {
      method: 'PATCH',
      body: { agent_email: trimmed, status: 'active' },
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
              {{ $t('linkAgent.title') }}
            </h3>
            <p class="text-xs text-muted mt-1">
              {{ $t('linkAgent.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField :label="$t('linkAgent.field.label')" :description="$t('linkAgent.field.description')" required>
          <UInput v-model="newEmail" placeholder="agent+alice+example.com@id.openape.ai" size="lg" class="w-full" :ui="{ base: 'w-full' }" autocomplete="off" autocapitalize="off" />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />
      </div>

      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" :disabled="submitting" @click="open = false">
          {{ $t('common.cancel') }}
        </UButton>
        <UButton color="primary" :loading="submitting" :disabled="!newEmail.trim()" @click="submit">
          {{ $t('linkAgent.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
