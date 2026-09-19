<script lang="ts">
import { t, diagnostic, label } from './i18n'
import { defineComponent } from 'vue'
import type { OnboardingCommand, OnboardingView } from '../contracts/onboarding'

export default defineComponent({
  emits: ['finished'],
  data() { return { view: null as OnboardingView | null, provider: 'openape' as 'chatgpt' | 'openape', account: '', issuer: 'https://id.openape.ai', busy: false, error: '', makeDefault: true, disconnecting: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: { globalConnections() { return this.view?.connections.filter(item => item.provider === 'chatgpt' || item.provider === 'openape') ?? [] } },
  async mounted() { await this.request({ type: 'list' }); this.poll() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label,
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { if (!this.busy) await this.request({ type: 'list' }); this.poll() }, 1000) },
    async request(command: OnboardingCommand) {
      if (this.busy) return
      this.busy = true
      try { const view = await window.pods.onboarding(command); if (!this.view) this.makeDefault = !view.defaultOwner; this.view = view; if (command.type !== 'list') this.error = '' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Setup failed' }
      finally { this.busy = false }
    },
    async connect() { await this.request({ type: 'connect', provider: this.provider, account: this.account, ...(this.provider === 'openape' ? { issuer: this.issuer, makeDefault: this.makeDefault } : {}) }) },
    async disconnect() { await this.request({ type: 'disconnect', id: this.disconnecting }); if (!this.error) this.disconnecting = '' },
    async finish() { await this.request({ type: 'finish' }); if (!this.error) this.$emit('finished') },
  },
})
</script>

<template>
  <section class="setup-view" :aria-label="t('Your accounts')">
    <article class="card">
      <p>{{ t("Your DDISA account approves permissions. Your Codex / GPT account provides AI access. Manage each pod’s identity in its own settings.") }}</p>
      <p v-if="view && !view.runtime.ready" role="alert" class="error-message">
        {{ view.runtime.error ? diagnostic(view.runtime.error) : t("Inspecting bundled tools…") }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ diagnostic(error) }}
      </p>
      <p v-if="view && !view.defaultOwner" role="status">
        {{ t('Choose an account for new pods. Existing pods keep their assigned account.') }}
      </p>
      <p v-else-if="view?.defaultOwner">
        {{ t('Your default account is used when a new pod first needs permissions. Existing pods keep their assigned account.') }}
      </p>
      <div v-for="connection in globalConnections" :key="connection.id" class="setup-connection">
        <strong>{{ connection.provider === 'chatgpt' ? t('Codex / GPT account') : t('Your DDISA identity') }}</strong>
        <span>{{ connection.account || t("Account selected during sign-in") }} · {{ connection.state === 'ready' ? t('Signed in') : label(connection.state) }}</span>
        <span v-if="connection.id === view?.defaultOwner" class="badge">{{ t('Default for new pods') }}</span>
        <button v-else-if="connection.provider === 'openape' && connection.state === 'ready'" :disabled="busy" @click="request({ type: 'setDefaultOwner', id: connection.id })">
          {{ t('Use for new pods') }}
        </button>
        <button v-if="connection.provider === 'openape' && ['expired', 'failed', 'revoked'].includes(connection.state)" :disabled="busy" @click="request({ type: 'reconnect', id: connection.id })">
          {{ t('Sign in again') }}
        </button>
        <p v-if="connection.error" role="alert">
          {{ diagnostic(connection.error) }}
        </p>
        <template v-if="connection.login">
          <p>{{ t("Complete sign-in in your browser.") }} <strong v-if="connection.login.code">{{ t("Code: {p0}", { p0: connection.login.code }) }}</strong></p>
          <button :disabled="busy" @click="request({ type: 'openLogin', id: connection.id })">
            {{ t("Open sign-in") }}
          </button>
          <input :aria-label="t('Sign-in address')" readonly :value="connection.login.url">
        </template>
        <button v-if="connection.state === 'connecting'" :disabled="busy" @click="request({ type: 'cancel', id: connection.id })">
          {{ t("Cancel sign-in") }}
        </button>
        <button v-if="connection.state === 'ready' || connection.state === 'expired'" :disabled="busy" @click="disconnecting = connection.id">
          {{ t("Disconnect") }}
        </button>
        <div v-if="disconnecting === connection.id" class="disconnect-review">
          <p>{{ connection.provider === 'openape' ? t('Disconnect this account? Permissions that use it will be revoked and affected pods paused. Their data and account assignments are kept.') : t('Disconnect ChatGPT? AI requests will stop until you connect again.') }}</p>
          <button :disabled="busy" @click="disconnect">
            {{ t('Confirm disconnect') }}
          </button>
          <button :disabled="busy" @click="disconnecting = ''">
            {{ t('Cancel') }}
          </button>
        </div>
      </div>
      <h3>{{ t('Connect an account') }}</h3>
      <form class="setup-form" @submit.prevent="connect">
        <label>{{ t("Connection") }}<select v-model="provider" :aria-label="t('Connection')"><option value="chatgpt">{{ t("Codex / GPT account") }}</option><option value="openape">{{ t("DDISA account") }}</option></select></label>
        <label v-if="provider !== 'chatgpt'">{{ t("Expected account") }}<input v-model="account" type="email" required autocomplete="email"></label>
        <template v-if="provider === 'openape'">
          <label class="default-choice"><input v-model="makeDefault" type="checkbox">{{ t('Use for new pods after sign-in') }}</label>
          <details><summary>{{ t('Advanced') }}</summary><label>{{ t("Identity provider") }}<input v-model="issuer" type="url" required></label></details>
        </template>
        <p>{{ t("Credentials stay in the Mac’s protected connection store. Pods and the master chat receive no account tokens.") }}</p>
        <button class="primary" :disabled="busy || !view?.runtime.ready">
          {{ t("Start sign-in") }}
        </button>
      </form>
      <p>{{ t('ChatGPT, Microsoft and Telegram have separate connections. Configure application accounts and secrets in each pod when needed.') }}</p>
    </article>
    <button :disabled="busy" @click="finish">
      {{ t("Continue to workspace") }}
    </button>
  </section>
</template>

<style scoped>
.setup-view { display: grid; gap: 20px; }
.setup-form { display: grid; gap: 14px; }
.setup-form label { display: grid; gap: 6px; }
.setup-form .default-choice { display: flex; align-items: center; }
.disconnect-review { border-left: 3px solid var(--border); padding-left: 12px; }
.setup-form details label { margin-top: 12px; }
.setup-form input:not([type=checkbox]), .setup-form select, .setup-connection input { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; }
.setup-connection { border-top: 1px solid var(--border); padding: 16px 0; display: grid; gap: 8px; overflow-wrap: anywhere; }
.setup-view button { justify-self: start; margin: 4px 8px 4px 0; }
</style>
