<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t, diagnostic } from './i18n'

const props = defineProps<{ podId: string }>()
const text = ref(''); const revision = ref(0); const error = ref(''); const busy = ref(false)
async function load() {
  try {
    const view = await window.pods.details({ type: 'list', podId: props.podId })
    text.value = view.description?.text ?? ''; revision.value = view.description?.revision ?? 0
  }
  catch (failure) { error.value = String(failure) }
}
async function save() {
  busy.value = true; error.value = ''
  try {
    const view = await window.pods.details({ type: 'describe', podId: props.podId, text: text.value, revision: revision.value })
    revision.value = view.description!.revision
  }
  catch (failure) { error.value = String(failure) }
  finally { busy.value = false }
}
onMounted(load)
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
