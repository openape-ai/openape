<script lang="ts">
import JevConnection from './JevConnection.vue'
import { t, diagnostic, label } from './i18n'
import { defineComponent } from 'vue'
import type { ConnectionView, OnboardingCommand, OnboardingView } from '../contracts/onboarding'

export default defineComponent({
  components: { JevConnection },
  emits: ['finished'],
  data() { return { view: null as OnboardingView | null, email: '', busy: false, error: '', switching: false, disconnecting: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: {
    codex(): ConnectionView | undefined { return this.view?.connections.find(item => item.provider === 'chatgpt') },
    owner(): ConnectionView | undefined { return this.view?.connections.find(item => item.id === this.view?.owner) },
    accounts(): { provider: 'chatgpt' | 'openape', title: string, connection: ConnectionView | undefined }[] { return [{ provider: 'chatgpt', title: t('Codex / GPT account'), connection: this.codex }, { provider: 'openape', title: t('Your DDISA account'), connection: this.owner }] },
    switchesAccount(): boolean { return !!this.owner && this.email.trim().toLowerCase() !== this.owner.account.toLowerCase() },
  },
  async mounted() { await this.request({ type: 'list' }); this.email = this.owner?.account ?? ''; this.poll() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label,
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { if (!this.busy) await this.request({ type: 'list' }); this.poll() }, 1000) },
    async request(command: OnboardingCommand) {
      if (this.busy) return
      this.busy = true
      try { this.view = await window.pods.onboarding(command); if (command.type !== 'list') this.error = '' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Setup failed' }
      finally { this.busy = false }
    },
    signedIn(connection: ConnectionView | undefined): boolean { return connection?.state === 'ready' },
    async signIn() {
      if (this.switchesAccount && !this.switching) { this.switching = true; return }
      await this.request({ type: 'connect', provider: 'openape', account: this.email.trim(), ...(this.switchesAccount ? { switchAccount: true } : {}) })
      this.switching = false
    },
    async disconnect() { await this.request({ type: 'disconnect', id: this.disconnecting }); if (!this.error) this.disconnecting = '' },
    async finish() { await this.request({ type: 'finish' }); if (!this.error) this.$emit('finished') },
  },
})
</script>

<template>
  <section class="setup-view" :aria-label="t('Your accounts')">
    <article class="card">
      <p>{{ t("Your DDISA account approves permissions. Your Codex / GPT account provides AI access.") }}</p>
      <p v-if="view && !view.runtime.ready" role="alert" class="error-message">
        {{ view.runtime.error ? diagnostic(view.runtime.error) : t("Inspecting bundled tools…") }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ diagnostic(error) }}
      </p>
      <section v-for="item in accounts" :key="item.provider" class="setup-connection" :aria-label="item.title">
        <strong>{{ item.title }}</strong>
        <span v-if="item.connection?.account">{{ item.connection.account }} · {{ signedIn(item.connection) ? t('Signed in') : label(item.connection.state) }}</span>
        <span v-else>{{ t('Not signed in') }}</span>
        <p v-if="item.connection?.error" role="alert">
          {{ diagnostic(item.connection.error) }}
        </p>
        <template v-if="item.connection?.login">
          <p>{{ t("Complete sign-in in your browser.") }} <strong v-if="item.connection.login.code">{{ t("Code: {p0}", { p0: item.connection.login.code }) }}</strong></p>
          <button :disabled="busy" @click="request({ type: 'openLogin', id: item.connection.id })">
            {{ t("Open sign-in") }}
          </button>
          <input :aria-label="t('Sign-in address')" readonly :value="item.connection.login.url">
        </template>
        <button v-if="item.connection?.state === 'connecting'" :disabled="busy" @click="request({ type: 'cancel', id: item.connection.id })">
          {{ t("Cancel sign-in") }}
        </button>
        <template v-else>
          <button v-if="item.provider === 'chatgpt' && !signedIn(item.connection)" class="primary" :disabled="busy || !view?.runtime.ready" @click="request({ type: 'connect', provider: 'chatgpt', account: '' })">
            {{ item.connection ? t('Sign in again') : t('Sign in') }}
          </button>
          <form v-if="item.provider === 'openape'" class="setup-form" @submit.prevent="signIn">
            <label>{{ t("Email") }}<input v-model="email" type="email" required autocomplete="email" :disabled="busy" @input="switching = false"></label>
            <button class="primary" :disabled="busy || !view?.runtime.ready">
              {{ switchesAccount ? t('Switch account') : item.connection ? t('Sign in again') : t('Sign in') }}
            </button>
            <div v-if="switching" class="disconnect-review">
              <p>{{ t('Switch to {p0}? Your pods receive new agents under this account, and their permissions must be granted again. Pod data is kept.', { p0: email.trim() }) }}</p>
              <button type="button" class="primary" :disabled="busy" @click="signIn">
                {{ t('Confirm switch') }}
              </button>
              <button type="button" :disabled="busy" @click="switching = false">
                {{ t('Cancel') }}
              </button>
            </div>
          </form>
        </template>
        <button v-if="item.connection && (item.connection.state === 'ready' || item.connection.state === 'expired')" :disabled="busy" @click="disconnecting = item.connection.id">
          {{ t("Disconnect") }}
        </button>
        <div v-if="item.connection && disconnecting === item.connection.id" class="disconnect-review">
          <p>{{ item.provider === 'openape' ? t('Disconnect this account? Permissions that use it will be revoked and affected pods paused. Their data and account assignments are kept.') : t('Disconnect ChatGPT? AI requests will stop until you connect again.') }}</p>
          <button :disabled="busy" @click="disconnect">
            {{ t('Confirm disconnect') }}
          </button>
          <button :disabled="busy" @click="disconnecting = ''">
            {{ t('Cancel') }}
          </button>
        </div>
      </section>
      <JevConnection :connection="view?.connections.find(item => item.provider === 'typesafe')" @updated="request({ type: 'list' })" />
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
.disconnect-review { border-left: 3px solid var(--border); padding-left: 12px; }
.setup-form input, .setup-connection input { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; }
.setup-connection { border-top: 1px solid var(--border); padding: 16px 0; display: grid; gap: 8px; overflow-wrap: anywhere; }
.setup-view button { justify-self: start; margin: 4px 8px 4px 0; }
</style>
