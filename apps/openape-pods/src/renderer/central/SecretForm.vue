<script setup lang="ts">
import { ref } from 'vue'
import { parseCredentialAlias } from '../../contracts/credentials'
import type { MessageKey } from '../../i18n'
import { diagnostic, t } from '../i18n'

/**
 * The three ways to give a Pod a secret: type it, read a private file on this Mac, or ask for it
 * through OpenApe Secrets. The value never leaves the desktop; the browser only sees the ways.
 */
const props = defineProps<{ podId: string, alias: string | null, desktop: boolean }>()
const emit = defineEmits<{ save: [podId: string, alias: string, value: string], file: [podId: string, alias: string], request: [podId: string, alias: string, purpose: string], cancel: [] }>()
const way = ref<'form' | 'file' | 'vault'>('form')
const alias = ref(props.alias ?? '')
const value = ref('')
const purpose = ref('')
const error = ref('')
const ways: { key: typeof way.value, label: MessageKey }[] = [{ key: 'form', label: 'Type it' }, { key: 'file', label: 'From a file' }, { key: 'vault', label: 'From OpenApe Secrets' }]
function submit() {
  error.value = ''
  let name: string
  try { name = parseCredentialAlias(alias.value.trim()) }
  catch (cause) { error.value = diagnostic(cause instanceof Error ? cause.message : String(cause)); return }
  if (way.value === 'form') {
    if (!value.value) { error.value = t('Enter the value'); return }
    emit('save', props.podId, name, value.value); value.value = ''
  }
  else if (way.value === 'file') {
    emit('file', props.podId, name)
  }
  else {
    emit('request', props.podId, name, purpose.value.trim())
  }
}
</script>

<template>
  <form class="secret-form" data-testid="secret-form" @submit.prevent="submit">
    <div class="seg" role="group" :aria-label="t('Way')">
      <button v-for="item in ways" :key="item.key" type="button" :aria-pressed="way === item.key" @click="way = item.key">
        {{ t(item.label) }}
      </button>
    </div>
    <label>{{ t('Alias') }} <input v-model="alias" autocomplete="off" :placeholder="t('e.g. telegram_bot_token')" :disabled="!desktop"></label>
    <label v-if="way === 'form'">{{ t('Value') }} <input v-model="value" type="password" autocomplete="off" :placeholder="t('cleared after saving')" :disabled="!desktop"></label>
    <p v-else-if="way === 'file'" class="meta">
      {{ t('The app reads the file itself, for example a PEM key.') }}
    </p>
    <template v-else>
      <label>{{ t('Purpose') }} <input v-model="purpose" maxlength="500" :placeholder="t('what the value is needed for')" :disabled="!desktop"></label>
      <p class="meta">
        {{ t('Pods is registered as a machine at secrets.openape.ai. The request goes to you; you fill it in the browser, the value is sealed there against the key of this Mac, Pods collects it once.') }}
      </p>
    </template>
    <div class="opts">
      <button class="primary" type="submit" :disabled="!desktop" :title="desktop ? undefined : t('Only on the desktop')">
        {{ way === 'file' ? t('Choose file…') : way === 'vault' ? t('Request') : t('Save') }}
      </button><button class="secondary" type="button" @click="emit('cancel')">
        {{ t('Cancel') }}
      </button>
    </div>
    <p v-if="error" class="error-message" role="alert">
      {{ error }}
    </p>
    <p class="meta">
      {{ t('Encrypted on this Mac, only for this Pod. Never in backups, never in Codex, never in chat.') }}
    </p>
  </form>
</template>

<style>
.secret-form{display:grid;gap:8px;margin-top:6px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}
.secret-form .seg{display:inline-flex;flex-wrap:wrap;gap:2px;border:1px solid var(--border);border-radius:8px;padding:2px;background:var(--surface);justify-self:start}
.secret-form .seg button{font-size:13px;font-weight:500;color:var(--muted);border-radius:6px;padding:4px 10px;border:0;background:transparent}
.secret-form .seg button[aria-pressed="true"]{background:var(--tint);color:var(--accent);font-weight:600}
.secret-form label{display:grid;gap:4px;font-size:13px}
.secret-form input{font:inherit;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)}
.secret-form .meta{font-size:12px;color:var(--muted);margin:0}
.secret-form .opts{display:flex;flex-wrap:wrap;gap:6px}
.secret-form .primary,.secret-form .secondary{padding:6px 12px;font-size:14px}
</style>
