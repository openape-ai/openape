<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InboxItem, Receipt } from '../inbox/client'
import { t } from '../inbox/i18n'
import { repairPrompt } from '../inbox/repair'
import { receiptText } from '../inbox/receipt'

const props = defineProps<{ item: InboxItem, receipt?: Receipt }>()
const prompt = computed(() => repairPrompt(props.item, props.receipt))
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const copying = ref(false)
const expanded = ref(false)
watch(prompt, () => { copyState.value = 'idle' })

async function copy() {
  const text = prompt.value
  copying.value = true
  copyState.value = 'idle'
  try {
    await navigator.clipboard.writeText(text)
    if (prompt.value === text) copyState.value = 'copied'
  }
  catch {
    copyState.value = 'failed'
    expanded.value = true
  }
  finally { copying.value = false }
}
</script>

<template>
  <section class="repair" :aria-label="t('repairHelp')">
    <p>{{ t('repairLead') }}</p>
    <button type="button" :disabled="copying" @click="copy">
      {{ copyState === 'copied' ? t('repairCopied') : t('repairCopy') }}
    </button>
    <p v-if="copyState === 'copied'" role="status">
      {{ t('repairPaste') }}
    </p>
    <p v-if="copyState === 'failed'" class="inbox-error" role="alert">
      {{ t('repairCopyFailed') }}
    </p>
    <p v-if="receipt" class="inbox-muted" role="status">
      {{ receiptText(receipt) }}
    </p>
    <details :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
      <summary>{{ t('repairShowPrompt') }}</summary>
      <textarea :value="prompt" readonly rows="10" :aria-label="t('repairShowPrompt')" spellcheck="false" @focus="($event.target as HTMLTextAreaElement).select()" />
    </details>
  </section>
</template>

<style scoped>
.repair { display: grid; gap: 10px; margin-top: 12px; }
.repair p { margin: 0; }
.repair button { width: 100%; }
.repair summary { cursor: pointer; color: var(--muted); padding: 8px 0; }
.repair textarea { display: block; width: 100%; font-size: .8em; margin-top: 8px; }
</style>
