<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { ConnectionView, OnboardingCommand } from '../contracts/onboarding'
import { t, diagnostic, label } from './i18n'

export default defineComponent({
  props: { connection: { type: Object as PropType<ConnectionView>, default: undefined } },
  emits: ['updated'],
  data() { return { key: '', busy: false, error: '' } },
  methods: {
    t, diagnostic, label,
    async execute(command: OnboardingCommand) {
      if (this.busy) return
      this.busy = true; this.error = ''
      try { await window.pods.onboarding(command); this.$emit('updated') }
      catch (error) { this.error = error instanceof Error ? error.message : 'TypeSafe connection failed' }
      finally { this.busy = false }
    },
    async save() { const key = this.key; this.key = ''; await this.execute({ type: 'saveTypesafe', key }) },
  },
})
</script>

<template>
  <section class="jev-connection" :aria-label="t('TypeSafe / Jev')">
    <h3>{{ t('TypeSafe / Jev') }} · {{ t('Optional') }}</h3>
    <p>{{ t('Jev makes structured decisions in your scripts. Codex can write those scripts for you.') }}</p>
    <p role="status">
      {{ connection?.state === 'ready' ? t('Connected') : connection ? label(connection.state) : t('Not connected') }}
    </p>
    <p>{{ t('The key stays encrypted on this Mac. Assign Jev separately in each Pod’s Permissions.') }}</p>
    <form @submit.prevent="save">
      <label>{{ t('TypeSafe API key') }}<input v-model="key" type="password" autocomplete="new-password" maxlength="4096" required :disabled="busy"></label>
      <button class="primary" :disabled="busy || !key">
        {{ busy ? t('Verifying…') : t('Connect or replace API key') }}
      </button>
      <a href="https://console.typesafe.ai" target="_blank" rel="noopener noreferrer">{{ t('Create an API key') }}</a>
    </form>
    <button v-if="connection && connection.state !== 'revoked'" class="secondary" :disabled="busy" @click="execute({ type: 'disconnect', id: connection.id })">
      {{ t('Disconnect TypeSafe and revoke Pod access') }}
    </button>
    <p v-if="error || connection?.error" role="alert">
      {{ diagnostic(error || connection?.error) }}
    </p>
  </section>
</template>

<style scoped>
.jev-connection{border-top:1px solid var(--border);padding:16px 0;overflow-wrap:anywhere}
form,label{display:grid;gap:10px}input{width:100%;box-sizing:border-box;min-width:0;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit}button{justify-self:start;margin:8px 0}
</style>
