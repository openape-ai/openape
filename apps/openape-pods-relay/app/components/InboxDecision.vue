<script setup lang="ts">
import { computed, ref } from 'vue'
import { blocking } from '../inbox/client'
import type { InboxItem, Receipt } from '../inbox/client'
import { t } from '../inbox/i18n'

const props = defineProps<{ item: InboxItem, receipt: Receipt | undefined, online: boolean, checking: boolean }>()
const emit = defineEmits<{ decide: [option: string, input?: string], check: [] }>()
const chosen = ref<string | null>(null)
const input = ref('')
const missing = ref(false)

const decision = computed(() => props.item.decision)
const open = computed(() => props.item.state === 'open')
// Only a verified HTTPS handoff is offered, also for copies restored from device storage.
const link = computed(() => {
  const candidate = decision.value && decision.value.authority !== 'pods' ? props.item.links[0] : undefined
  return candidate && /^https:\/\//.test(candidate.url) ? candidate : null
})
const authority = computed(() => t(decision.value?.authority === 'secrets' ? 'authoritySecrets' : 'authorityIdp'))
const blocked = computed(() => blocking(props.receipt, props.item))
const selected = computed(() => decision.value?.options.find(option => option.key === chosen.value) ?? null)

const errors: Record<string, Parameters<typeof t>[0]> = { decision_changed: 'errorChanged', decision_resolved: 'errorResolved', pod_offline: 'errorPodOffline', workspace_busy: 'errorBusy', workspace_revision_conflict: 'errorBusy', invalid_inbox_input: 'errorInput', network: 'errorNetwork' }
function errorText(code: string | null): string {
  if (!code) return ''
  const key = errors[code]
  return key ? t(key) : /^[a-z_]+$/.test(code) ? t('errorGeneric', { code }) : code
}
const receiptText = computed(() => {
  const receipt = props.receipt
  if (!receipt) return ''
  const values = { option: receipt.title, error: errorText(receipt.error) }
  return { sending: t('receiptSending', values), unsent: t('receiptUnsent', values), refused: errorText(receipt.error), accepted: t('receiptAccepted', values), started: t('receiptStarted', values), applied: t('receiptApplied', values), failed: t('receiptFailed', values), unknown: t('receiptUnknown', values) }[receipt.state]
})

function choose(key: string) {
  const option = decision.value?.options.find(entry => entry.key === key)
  if (!option) return
  if (!option.input) { emit('decide', option.key); return }
  chosen.value = option.key; input.value = ''; missing.value = false
}
function submit() {
  if (!selected.value) return
  if (!input.value.trim()) { missing.value = true; return }
  emit('decide', selected.value.key, input.value)
  chosen.value = null
}
</script>

<template>
  <section class="decision" :aria-label="t('decideTitle')">
    <p v-if="receiptText" class="receipt" :class="receipt?.state" role="status">
      {{ receiptText }}
    </p>
    <div v-if="receipt?.state === 'unsent' && open" class="row">
      <button type="button" :disabled="!online" @click="emit('decide', receipt.option)">
        {{ t('receiptRetry') }}
      </button>
    </div>
    <div v-else-if="receipt && ['accepted', 'started'].includes(receipt.state) && !checking" class="row">
      <span class="inbox-muted">{{ t('receiptPending') }}</span>
      <button type="button" class="secondary" :disabled="!online" @click="emit('check')">
        {{ t('receiptCheck') }}
      </button>
    </div>

    <p v-if="!open" class="inbox-done">
      {{ t('itemResolved') }}
    </p>
    <template v-else-if="link">
      <p>{{ t('decideExternal', { authority }) }}</p>
      <a class="handoff" :href="link.url" target="_blank" rel="noopener noreferrer">{{ t('decideExternalOpen', { authority }) }}</a>
    </template>
    <p v-else-if="!decision?.options.length" class="inbox-note">
      {{ t('decideDesktop') }}
    </p>
    <template v-else-if="!blocked">
      <p v-if="!online" class="inbox-note">
        {{ t('decideOffline') }}
      </p>
      <div class="options">
        <button v-for="option in decision.options" :key="option.key" type="button" :class="{ secondary: chosen && chosen !== option.key }" :disabled="!online" :aria-expanded="option.input ? chosen === option.key : undefined" @click="choose(option.key)">
          {{ option.title }}
        </button>
      </div>
      <form v-if="selected && online" class="input" @submit.prevent="submit">
        <label for="decision-input">{{ selected.input === 'evidence' ? t('decideEvidence') : t('decideValue') }}</label>
        <textarea v-if="selected.input === 'evidence'" id="decision-input" v-model="input" rows="3" maxlength="4000" :aria-invalid="missing" aria-describedby="decision-missing" @input="missing = false" />
        <input v-else id="decision-input" v-model="input" maxlength="4000" :aria-invalid="missing" aria-describedby="decision-missing" @input="missing = false">
        <small v-if="missing" id="decision-missing" class="inbox-error">{{ t('decideRequired') }}</small>
        <button type="submit">
          {{ t('decideSubmit', { option: selected.title }) }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.decision { margin-top: 16px; display: grid; gap: 10px; }
.options { display: grid; gap: 8px; }
.options button { width: 100%; text-align: left; padding: 10px 16px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.input { display: grid; gap: 8px; }
.input label { color: var(--muted); }
.receipt { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
.receipt.applied { border-color: var(--accent); }
.receipt.failed, .receipt.refused, .receipt.unsent, .receipt.unknown { border-color: var(--warn); color: var(--warn); }
.handoff { display: flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 10px; background: var(--accent); color: var(--bg) !important; text-decoration: none; padding: 0 16px; }
</style>
