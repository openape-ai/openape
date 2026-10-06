<script setup lang="ts">
import { ref } from 'vue'

export interface SourcePlan { id: string, title: string, body_md: string, status: string, version: number, caller_role: string }
const props = defineProps<{ plan: SourcePlan }>()
const title = ref(props.plan.title); const source = ref(props.plan.body_md); const status = ref(props.plan.status)
const saving = ref(false); const error = ref('')
async function save() {
  saving.value = true; error.value = ''
  try {
    await $fetch(`/api/plans-compat/plans/${props.plan.id}`, { method: 'PATCH', body: { title: title.value, body_md: source.value, status: status.value, expected_version: props.plan.version } })
    await navigateTo(`/d/${props.plan.id}`)
  }
  catch (failure) {
    const code = (failure as { statusCode?: number }).statusCode
    error.value = code === 409 ? 'Another version was saved. Your draft is still here. Copy it before opening the latest version and reconciling the changes.' : 'Save failed. Your draft is still here; check your access and retry.'
  }
  finally { saving.value = false }
}
</script>

<template>
  <main class="plan-editor">
    <NuxtLink :to="`/d/${plan.id}`">
      ← Read plan
    </NuxtLink><h1>Edit plan source</h1>
    <p>Editing version {{ plan.version }}. Status describes progress; it does not record approval.</p>
    <form v-if="plan.caller_role !== 'viewer'" @submit.prevent="save">
      <label>Title <input v-model="title" required maxlength="200"></label>
      <label>Status <select v-model="status"><option>draft</option><option>active</option><option>done</option><option>archived</option></select></label>
      <label>Markdown or compatible HTML source <textarea v-model="source" spellcheck="false" rows="24" /></label>
      <p v-if="error" role="alert">
        {{ error }} <a :href="`/d/${plan.id}`" target="_blank" rel="noopener noreferrer">Open latest version</a>
      </p>
      <button type="submit" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save new version' }}
      </button>
    </form>
    <p v-else>
      Viewers cannot edit plans.
    </p>
  </main>
</template>

<style scoped>
.plan-editor{font:16px/1.6 system-ui;padding:24px;max-width:1100px;margin:auto}h1{font-size:2rem}label{display:flex;flex-direction:column;gap:6px;margin:18px 0}input,select,textarea,button{font:inherit;background:transparent;color:inherit;border:1px solid #aab8ad;border-radius:5px;padding:8px}textarea{width:100%;font:14px/1.5 monospace}button{cursor:pointer}a{text-decoration:underline}[role=alert]{border:1px solid #d97706;padding:12px}
</style>
