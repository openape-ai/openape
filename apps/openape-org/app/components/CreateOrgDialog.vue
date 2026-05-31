<script setup lang="ts">
import { ref, watch } from 'vue'

const emit = defineEmits<{ created: [{ id: string, name: string }] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const form = ref({ name: '', vision_md: '', budget_monthly_eur: 50 })
const submitting = ref(false)
const error = ref('')

watch(open, (now) => {
  if (!now) return
  form.value = { name: '', vision_md: '', budget_monthly_eur: 50 }
  error.value = ''
  submitting.value = false
})

async function submit() {
  if (!form.value.name.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const res = await ($fetch as any)('/api/orgs', { method: 'POST', body: form.value })
    emit('created', res)
    open.value = false
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('orgsIndex.error.createFailed')
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
              {{ $t('createOrg.title') }}
            </h3>
            <p class="text-xs text-muted mt-1">
              {{ $t('createOrg.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <UFormField :label="$t('createOrg.field.name.label')" :description="$t('createOrg.field.name.description')" required>
          <UInput v-model="form.name" :placeholder="$t('createOrg.field.name.placeholder')" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField :label="$t('createOrg.field.vision.label')" :description="$t('createOrg.field.vision.description')">
          <UTextarea v-model="form.vision_md" :rows="6" autoresize :placeholder="$t('createOrg.field.vision.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
        </UFormField>

        <UFormField :label="$t('createOrg.field.budget.label')" :description="$t('createOrg.field.budget.description')">
          <UInput v-model.number="form.budget_monthly_eur" type="number" :min="0" :max="1000000" size="lg" class="w-full">
            <template #trailing>
              <span class="text-muted">€/Mo</span>
            </template>
          </UInput>
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />
      </div>

      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" :disabled="submitting" @click="open = false">
          {{ $t('common.cancel') }}
        </UButton>
        <UButton color="primary" :loading="submitting" :disabled="!form.name.trim()" @click="submit">
          {{ $t('createOrg.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
