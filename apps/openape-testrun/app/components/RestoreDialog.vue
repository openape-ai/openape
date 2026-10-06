<script setup lang="ts">
import { ref, watch } from 'vue'
import AppDialog from './AppDialog.vue'

const props = defineProps<{ open: boolean, title: string, busy: boolean, error: string }>()
const emit = defineEmits<{ close: [], restore: [lifetime: { permanent: true } | { expiresIn: string }] }>()
const KEEP = [['permanent', 'Permanently', 'Until you remove it'], ['30d', '30 days', ''], ['7d', '7 days', '']] as const
const keep = ref<string>('permanent')
watch(() => props.open, (open) => { if (open) keep.value = 'permanent' })
</script>

<template>
  <AppDialog :open="open" title="Restore report" center @close="emit('close')">
    <p><strong>{{ title }}</strong></p>
    <p class="hint">
      Restored reports start private. Only you can open it until you share it again.
    </p>
    <fieldset class="field">
      <legend>Keep it for</legend>
      <div class="radios">
        <label v-for="[value, label, note] in KEEP" :key="value"><input v-model="keep" type="radio" name="keep" :value="value"><span>{{ label }}<small v-if="note">{{ note }}</small></span></label>
      </div>
    </fieldset>
    <p v-if="error" role="alert" class="error">
      {{ error }}
    </p>
    <template #foot>
      <button class="btn quiet" type="button" @click="emit('close')">
        Cancel
      </button>
      <button class="btn primary" type="button" :disabled="busy" @click="emit('restore', keep === 'permanent' ? { permanent: true } : { expiresIn: keep })">
        {{ busy ? 'Restoring…' : 'Restore privately' }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
p { margin: 0; overflow-wrap: anywhere; }
.error { color: var(--bad); font-size: 14px; }
</style>
