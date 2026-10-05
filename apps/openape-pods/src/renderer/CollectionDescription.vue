<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CollectionDescription } from '../contracts/control'
import { t } from './i18n'

const props = defineProps<{ description: CollectionDescription | undefined, label: string, readOnly?: boolean }>()
const emit = defineEmits<{ save: [text: string] }>()
const editing = ref(false)
const draft = ref('')
// The form closes when the saved text arrives, so a refused save keeps the draft.
watch(() => props.description?.revision, () => { editing.value = false })
function edit() { draft.value = props.description?.text ?? ''; editing.value = true }
</script>

<template>
  <div v-if="description || !readOnly" class="collection-description">
    <form v-if="editing" @submit.prevent="emit('save', draft)">
      <label><span>{{ label }}</span><textarea v-model="draft" maxlength="1000" rows="3" /></label>
      <div class="overview-actions">
        <button class="secondary" type="submit">
          {{ t('Save description') }}
        </button>
        <button class="text-button" type="button" @click="editing = false">
          {{ t('Cancel') }}
        </button>
      </div>
    </form>
    <template v-else>
      <p v-if="description">
        {{ description.text }}
      </p>
      <button v-if="!readOnly" class="text-button" type="button" @click="edit">
        {{ t(description ? 'Edit description' : 'Add description') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.collection-description{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
.collection-description p{margin:0;max-width:72ch;overflow-wrap:anywhere}
.collection-description>.text-button{margin-left:0}
form{display:flex;flex-direction:column;gap:8px;width:100%;max-width:72ch}
label span{display:block;margin-bottom:6px;color:var(--muted)}
textarea{box-sizing:border-box;width:100%;font:inherit}
</style>
