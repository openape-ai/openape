<script setup lang="ts">
import type { SecretType } from '~/utils/vault-client'
import { computed, ref, watch } from 'vue'
import { SECRET_TYPE_LABELS } from '~/utils/vault-client'

/**
 * Add a secret, or save a new version of one. The value is typed here and
 * sealed in this browser; the parent does the passkey flow on `save`.
 */
const props = defineProps<{ secret?: { alias: string, type: SecretType, version: number } | null, busy: boolean, error: string }>()
const emit = defineEmits<{ save: [input: { alias: string, type: SecretType, value: string }] }>()
const open = defineModel<boolean>('open', { required: true })

const alias = ref('')
const type = ref<SecretType>('token')
const value = ref('')
const reveal = ref(false)

const isNew = computed(() => !props.secret)
const types = Object.entries(SECRET_TYPE_LABELS).map(([value, label]) => ({ value: value as SecretType, label }))
const canSave = computed(() => !!value.value && (!isNew.value || /^[\w.-]{1,80}$/.test(alias.value)))

watch(open, (isOpen) => {
  if (!isOpen) return
  alias.value = props.secret?.alias ?? ''
  type.value = props.secret?.type ?? 'token'
  value.value = ''
  reveal.value = false
})

function save() {
  if (canSave.value) emit('save', { alias: alias.value, type: type.value, value: value.value })
}

/** Drop the typed value as soon as the parent is done with it. */
defineExpose({ clear: () => { value.value = '' } })
</script>

<template>
  <UModal v-model:open="open" :title="isNew ? 'Add a secret' : `New version of ${secret?.alias}`" :description="isNew ? 'Stored encrypted. Only your passkey opens it.' : `Version ${(secret?.version ?? 0) + 1} replaces version ${secret?.version}. Earlier versions stay in the history.`">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <UFormField v-if="isNew" label="Name" help="Agents ask for it by this name, for example TELEGRAM_BOT_TOKEN.">
          <UInput v-model="alias" class="w-full" :ui="{ base: 'font-mono' }" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TELEGRAM_BOT_TOKEN" />
        </UFormField>
        <UFormField v-if="isNew" label="Type">
          <USelect v-model="type" :items="types" class="w-full" />
        </UFormField>
        <UFormField label="Value">
          <UTextarea v-if="type === 'note'" v-model="value" :rows="5" autoresize class="w-full" :ui="{ base: 'font-mono' }" />
          <UInput v-else v-model="value" :type="reveal ? 'text' : 'password'" class="w-full" :ui="{ base: 'font-mono', trailing: 'pe-1' }" autocomplete="off" spellcheck="false">
            <template #trailing>
              <UButton color="neutral" variant="link" size="sm" :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'" :aria-label="reveal ? 'Hide value' : 'Show value'" @click="reveal = !reveal" />
            </template>
          </UInput>
        </UFormField>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            Cancel
          </UButton>
          <UButton type="submit" icon="i-lucide-key-round" :disabled="!canSave" :color="canSave ? 'primary' : 'neutral'" :variant="canSave ? 'solid' : 'subtle'" :loading="busy">
            Save with passkey
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
