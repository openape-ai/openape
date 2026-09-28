<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { descriptionDrafts } from './form-buffer'
import { usePodAccess, usePodEdits } from './pod-access'
import { t, diagnostic } from './i18n'

const props = defineProps<{ podId: string }>()
const access = usePodAccess()
const saved = ref('')

const text = ref(''); const revision = ref(0); const error = ref(''); const busy = ref(false)
async function load() {
  try {
    const view = await access.api.details({ type: 'list', podId: props.podId })
    text.value = view.description?.text ?? ''; revision.value = view.description?.revision ?? 0; saved.value = text.value
  }
  catch (failure) { error.value = String(failure) }
}
async function save() {
  busy.value = true; error.value = ''
  try {
    const view = await access.api.details({ type: 'describe', podId: props.podId, text: text.value, revision: revision.value })
    revision.value = view.description!.revision; saved.value = text.value
  }
  catch (failure) { error.value = String(failure) }
  finally { busy.value = false }
}
watch(() => access.revision?.value, () => { if (!busy.value && !error.value && text.value === saved.value) void load() })
usePodEdits('description', () => text.value !== saved.value)
onMounted(async () => {
  const draft = access.remote ? descriptionDrafts.get(access.key(props.podId)) : undefined
  if (draft) { text.value = draft.text; revision.value = draft.revision; saved.value = draft.saved }
  else {
    await load()
  }
})
onBeforeUnmount(() => { if (access.remote && text.value !== saved.value) descriptionDrafts.set(access.key(props.podId), { text: text.value, revision: revision.value, saved: saved.value }); else descriptionDrafts.delete(access.key(props.podId)) })
</script>

<template>
  <form class="card" @submit.prevent="save">
    <h2>{{ t('Description') }}</h2>
    <label for="pod-description">{{ t('What should this Pod do?') }}</label>
    <textarea id="pod-description" v-model="text" maxlength="4000" rows="3" :disabled="busy" />
    <div class="overview-actions">
      <button class="secondary" type="submit" :disabled="busy">
        {{ t('Save description') }}
      </button>
      <button class="text-button" type="button" :disabled="busy" @click="load">
        {{ t('Reload') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </form>
</template>

<style scoped>
label { display:block; margin-bottom:8px; color:var(--muted); }
textarea { display:block; width:100%; min-height:88px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font:inherit; resize:vertical; }
</style>
