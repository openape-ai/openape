<script lang="ts">
import { t, diagnostic, label } from './i18n'
import { defineComponent } from 'vue'
import type { OnboardingCommand, OnboardingView } from '../contracts/onboarding'
import type { StoredPod } from '../contracts/control'

export default defineComponent({
  props: { pod: { type: Object as () => StoredPod, default: undefined } },
  emits: ['finished', 'reference'],
  data() { return { view: null as OnboardingView | null, provider: 'chatgpt' as 'chatgpt' | 'openape', account: '', issuer: 'https://id.openape.ai', busy: false, error: '', message: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: { globalConnections() { return this.view?.connections.filter(item => item.provider === 'chatgpt' || item.provider === 'openape') ?? [] } },
  async mounted() { await this.request({ type: 'list' }); this.poll() },
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
    async connect() { await this.request({ type: 'connect', provider: this.provider, account: this.account, ...(this.provider === 'openape' ? { issuer: this.issuer } : {}) }) },
    async finish() { await this.request({ type: 'finish' }); if (!this.error) this.$emit('finished') },
  },
})
</script>

<template>
  <section class="setup-view" :aria-label="t('Connections and setup')">
    <article class="card">
      <h2>{{ t("Connections & setup") }}</h2>
      <p>{{ t("Connect ChatGPT for AI and OpenApe for pod permissions. Configure other programs in each pod’s Permissions tab.") }}</p>
      <p v-if="view && !view.runtime.ready" role="alert" class="error-message">
        {{ view.runtime.error ? diagnostic(view.runtime.error) : t("Inspecting bundled tools…") }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ diagnostic(error) }}
      </p>
      <p v-if="message" role="status">
        {{ diagnostic(message) }}
      </p>
      <div v-for="connection in globalConnections" :key="connection.id" class="setup-connection">
        <strong>{{ connection.provider === 'chatgpt' ? t("ChatGPT") : connection.provider === 'openape' ? t("OpenApe identity") : t("OpenApe identity") }}</strong>
        <span>{{ connection.account || t("Account selected during sign-in") }} · {{ label(connection.state) }}</span>
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
        <button v-if="connection.state === 'ready' || connection.state === 'expired'" :disabled="busy" @click="request({ type: 'disconnect', id: connection.id })">
          {{ t("Disconnect") }}
        </button>
      </div>
      <form class="setup-form" @submit.prevent="connect">
        <label>{{ t("Connection") }}<select v-model="provider" :aria-label="t('Connection')"><option value="chatgpt">{{ t("ChatGPT · model execution") }}</option><option value="openape">{{ t("OpenApe · pod permissions") }}</option></select></label>
        <label v-if="provider !== 'chatgpt'">{{ t("Expected account") }}<input v-model="account" type="email" required autocomplete="email"></label>
        <label v-if="provider === 'openape'">{{ t("Identity provider") }}<input v-model="issuer" type="url" required></label>
        <p>{{ t("Credentials stay in the Mac’s protected connection store. Pods and the master chat receive no account tokens.") }}</p>
        <button class="primary" :disabled="busy || !view?.runtime.ready">
          {{ t("Start sign-in") }}
        </button>
      </form>
    </article>
    <article class="card">
      <h2>{{ t("References and first run") }}</h2>
      <p>{{ t("Optional reference files become separate read-only snapshots for each run. Choose a validated script in Script, then use Run once and inspect its sources. Enable a schedule separately after that review.") }}</p>
      <button :disabled="!pod" @click="$emit('reference')">
        {{ t("Open pod permissions") }}
      </button>
      <button :disabled="busy" @click="finish">
        {{ t("Continue to workspace") }}
      </button>
    </article>
  </section>
</template>

<style scoped>
.setup-view { display: grid; gap: 20px; }
.setup-form { display: grid; gap: 14px; }
.setup-form label { display: grid; gap: 6px; }
.setup-form label:has(input[type=checkbox]) { display: flex; align-items: start; }
.setup-form input:not([type=checkbox]), .setup-form select, .setup-connection input { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: inherit; }
.setup-connection { border-top: 1px solid var(--line); padding: 16px 0; display: grid; gap: 8px; overflow-wrap: anywhere; }
.setup-view button { justify-self: start; margin: 4px 8px 4px 0; }
.setup-folders { max-height: 260px; overflow: auto; border: 1px solid var(--line); display: grid; gap: 8px; }
</style>
