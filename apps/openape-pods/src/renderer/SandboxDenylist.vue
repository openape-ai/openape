<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseSandboxDenyPath } from '../contracts/sandbox'
import type { SandboxView } from '../contracts/sandbox'
import { diagnostic, t } from './i18n'

const props = defineProps<{ sandbox: SandboxView, busy: boolean, readonly?: boolean }>()
const emit = defineEmits<{ save: [deny: string[]] }>()
const entry = ref('')
const error = ref('')
const own = computed(() => props.sandbox.denySources.find(item => item.source === 'pod')?.deny ?? [])
const inherited = computed(() => props.sandbox.denySources.filter(item => item.source !== 'pod').flatMap(item => item.deny).filter(path => !own.value.includes(path)))

function add(): void {
  error.value = ''
  try {
    const path = parseSandboxDenyPath(entry.value.trim())
    if (!own.value.includes(path)) emit('save', [...own.value, path])
    entry.value = ''
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Invalid path' }
}
</script>

<template>
  <section>
    <h3>{{ t('Sandbox') }}</h3>
    <p class="muted">
      {{ sandbox.level === 'owner' ? t('Owner level: programs reach what you reach on this Mac, except the Pods data and your apes login.') : t('Isolated level: programs reach only this pod and what is assigned to it.') }}
    </p>
    <p v-if="sandbox.level === 'owner'" class="trust-note">
      <strong>{{ t('Running as owner means full trust in this pod\'s code, including the possibility to act as you. The remaining protections only prevent direct access.') }}</strong>
    </p>
    <div class="deny-list" role="group" :aria-label="t('Denied paths')">
      <article v-for="path in own" :key="path" class="deny-row">
        <span class="deny-path">{{ path }}</span>
        <button class="text-button" :aria-label="t('Allow {path} again', { path })" :title="t('Allow {path} again', { path })" :disabled="busy || readonly" @click="emit('save', own.filter(item => item !== path))">
          −
        </button>
      </article>
      <article v-for="path in inherited" :key="`network:${path}`" class="deny-row">
        <span class="deny-path">{{ path }}<small>{{ t('Denied by a network') }}</small></span>
      </article>
      <p v-if="!own.length && !inherited.length" class="deny-row muted">
        {{ t('No denied paths') }}
      </p>
      <form v-if="!readonly" class="deny-row" @submit.prevent="add">
        <input v-model="entry" :aria-label="t('Path to deny')" :placeholder="t('~/.ssh or an absolute path')" maxlength="1024" autocomplete="off" :disabled="busy">
        <button class="secondary" :disabled="busy || !entry.trim()">
          {{ t('Deny') }}
        </button>
      </form>
    </div>
    <p class="muted">
      {{ t('Programs of this pod can neither read nor write a denied path, at either level.') }}
    </p>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </section>
</template>

<style scoped>
.deny-list { background:var(--surface); border:1px solid var(--border); border-radius:12px; margin:16px 0; overflow:hidden; }
.deny-row { display:flex; align-items:center; gap:12px; margin:0; padding:10px 18px; border-bottom:1px solid var(--border); }
.deny-row:last-child { border-bottom:0; }
.deny-path { display:grid; gap:4px; flex:1; min-width:0; overflow-wrap:anywhere; font-size:14px; }
.deny-path small { color:var(--muted); font-size:12px; }
.deny-row input { flex:1; min-width:0; padding:7px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:inherit; font:inherit; }
.deny-row .text-button { font-size:23px; line-height:1; padding:2px 10px; margin:0; }
</style>
