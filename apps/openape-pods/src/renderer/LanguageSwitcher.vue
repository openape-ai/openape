<script setup lang="ts">
import { ref } from 'vue'
import { parseLanguage } from '../contracts/language'
import { language, applyLanguage, t, diagnostic } from './i18n'

const props = defineProps<{ browser?: boolean }>()
const busy = ref(false)
const error = ref('')
async function change(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  busy.value = true; error.value = ''
  try {
    const chosen = parseLanguage(select.value)
    if (props.browser) { localStorage.setItem('pods-language', chosen); applyLanguage(chosen) }
    else {
      applyLanguage(await window.pods.language({ type: 'set', language: chosen }))
    }
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not save language' }
  finally { select.value = language.value; busy.value = false }
}
</script>

<template>
  <div class="language-control">
    <label>{{ t('Language') }}<select :value="language" :disabled="busy" :aria-label="t('Language')" @change="change"><option value="de" lang="de">Deutsch</option><option value="en" lang="en">English</option></select></label>
    <p v-if="error" role="alert">
      {{ diagnostic(error) }}
    </p>
  </div>
</template>

<style scoped>
.language-control{font-size:12px;min-width:0;flex-shrink:0}
label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
select{min-width:0;max-width:100%;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px}
p{color:var(--muted);overflow-wrap:anywhere}
</style>
