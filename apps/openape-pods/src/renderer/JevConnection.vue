<script lang="ts">
import { defineComponent } from 'vue'
import type { ConnectionView, OnboardingCommand } from '../contracts/onboarding'
import { t, diagnostic } from './i18n'

export default defineComponent({
  data() { return { key: '', busy: false, error: '', connection: undefined as ConnectionView | undefined } },
  async mounted() { await this.execute({ type: 'list' }) },
  methods: {
    t, diagnostic,
    async execute(command: OnboardingCommand) {
      if (this.busy) return
      this.busy = true; this.error = ''
      try { this.connection = (await window.pods.onboarding(command)).connections.find(item => item.provider === 'typesafe') }
      catch (error) { this.error = error instanceof Error ? error.message : 'TypeSafe connection failed' }
      finally { this.busy = false }
    },
    async save() { const key = this.key; this.key = ''; await this.execute({ type: 'saveTypesafe', key }) },
  },
})
</script>

<template>
  <section class="jev-connection">
    <form @submit.prevent="save">
      <label>{{ t('TypeSafe AI - Jev - API Key') }}<input v-model="key" type="password" autocomplete="new-password" maxlength="4096" required :disabled="busy" :placeholder="connection?.state === 'ready' ? '••••••••' : ''"></label>
      <button class="primary" :disabled="busy || !key">
        {{ busy ? t('Verifying…') : t('Connect or replace API key') }}
      </button>
    </form>
    <p v-if="error || connection?.error" role="alert">
      {{ diagnostic(error || connection?.error) }}
    </p>
  </section>
</template>

<style scoped>
.jev-connection{border-top:1px solid var(--border);padding:16px 0;overflow-wrap:anywhere}
form,label{display:grid;gap:10px}input{width:100%;box-sizing:border-box;min-width:0;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:inherit}button{justify-self:start;margin:8px 0}
</style>
