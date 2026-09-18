<script lang="ts">
import { defineComponent } from 'vue'
import type { OnboardingView } from '../contracts/onboarding'
import { t, diagnostic, label } from './i18n'

export default defineComponent({
  props: { available: { type: Boolean, default: true } },
  emits: ['open'],
  data() { return { view: null as OnboardingView | null, error: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: {
    account() { return this.view?.connections.find(item => item.id === this.view?.defaultOwner) },
    status(): string {
      if (this.error) return t('Account status unavailable')
      if (!this.view) return t('Loading account…')
      if (!this.account) return t('Choose your account')
      return this.account.state === 'ready' ? t('Signed in') : label(this.account.state)
    },
  },
  async mounted() { await this.refresh() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic,
    async refresh() {
      try { if (!this.available) return; this.view = await window.pods.onboarding({ type: 'list' }); this.error = '' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Account status unavailable' }
      finally { if (!this.closed) this.timer = setTimeout(() => { void this.refresh() }, 1000) }
    },
  },
})
</script>

<template>
  <button class="account-status" :aria-label="t('OpenApe account')" :title="error ? diagnostic(error) : account?.account" @click="$emit('open')">
    <span class="account-avatar" aria-hidden="true">{{ account?.account.slice(0, 1).toUpperCase() || '○' }}</span>
    <span class="account-copy"><strong>{{ account?.account || t('OpenApe account') }}</strong><small>{{ status }}</small></span>
  </button>
</template>

<style scoped>
.account-status { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 10px 8px; text-align: left; }
.account-avatar { display: grid; place-items: center; width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); }
.account-copy { display: grid; gap: 3px; min-width: 0; }
.account-copy strong { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-copy small { color: var(--muted); font-size: 11px; }
</style>
