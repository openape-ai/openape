<script lang="ts">
import { defineComponent } from 'vue'
import type { ConnectionProvider, OnboardingCommand, OnboardingView } from '../contracts/onboarding'
import type { StoredPod } from '../contracts/control'

export default defineComponent({
  props: { pod: { type: Object as () => StoredPod, default: undefined } },
  emits: ['finished', 'assigned', 'reference'],
  data() { return { view: null as OnboardingView | null, provider: 'chatgpt' as ConnectionProvider, account: '', issuer: 'https://id.openape.ai', ownerId: '', mailId: '', folders: [] as { id: string, name: string }[], selected: [] as string[], since: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), allHistory: false, attachments: false, reviewed: false, busy: false, error: '', message: '', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: {
    reviewPodKey(): string { return `${this.pod?.id ?? ''}:${this.pod?.revision ?? 0}` },
    owners() { return this.view?.connections.filter(item => item.provider === 'openape' && item.state === 'ready') ?? [] },
    mailAccounts() { return this.view?.connections.filter(item => item.provider === 'microsoft' && item.state === 'ready') ?? [] },
    canAssign(): boolean { return !!this.pod && this.pod.lifecycle !== 'archived' && !!this.ownerId && !!this.mailId && this.selected.length > 0 && this.reviewed && !this.busy },
  },
  watch: { reviewPodKey() { this.reviewed = false } },
  async mounted() { await this.request({ type: 'list' }); this.poll() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { if (!this.busy) await this.request({ type: 'list' }); this.poll() }, 1000) },
    async request(command: OnboardingCommand) {
      if (this.busy) return
      this.busy = true
      try { this.view = await window.pods.onboarding(command); if (command.type !== 'list') this.error = ''; if (this.view.folders) { this.folders = this.view.folders.items; this.selected = []; this.reviewed = false } }
      catch (error) { this.error = error instanceof Error ? error.message : 'Setup failed' }
      finally { this.busy = false }
    },
    async connect() { await this.request({ type: 'connect', provider: this.provider, account: this.account, ...(this.provider === 'openape' ? { issuer: this.issuer } : {}) }) },
    async assign() {
      if (!this.pod || !this.canAssign) return
      const account = this.mailAccounts.find(item => item.id === this.mailId)?.account
      if (!account) return
      await this.request({ type: 'assign', setup: { podId: this.pod.id, revision: this.pod.revision, ownerConnection: this.ownerId, mailConnection: this.mailId, account, folders: this.folders.filter(folder => this.selected.includes(folder.id)), since: this.allHistory ? null : `${this.since}T00:00:00Z`, attachments: this.attachments } })
      if (!this.error) { this.message = 'Permission review finished. Inspect Resources before a manual first run.'; this.reviewed = false; this.$emit('assigned') }
    },
    async finish() { await this.request({ type: 'finish' }); if (!this.error) this.$emit('finished') },
  },
})
</script>

<template>
  <section class="setup-view" aria-label="Connections and setup">
    <article class="card">
      <h2>Connections &amp; setup</h2>
      <p>Connect three separate accounts, review this pod’s resources, then start its first run manually. Setup does not enable automatic runs.</p>
      <p v-if="view && !view.runtime.ready" role="alert" class="error-message">
        {{ view.runtime.error || 'Inspecting bundled tools…' }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ error }}
      </p>
      <p v-if="message" role="status">
        {{ message }}
      </p>
      <div v-for="connection in view?.connections" :key="connection.id" class="setup-connection">
        <strong>{{ connection.provider === 'chatgpt' ? 'ChatGPT' : connection.provider === 'openape' ? 'OpenApe identity' : 'Microsoft 365' }}</strong>
        <span>{{ connection.account || 'Account selected during sign-in' }} · {{ connection.state }}</span>
        <p v-if="connection.error" role="alert">
          {{ connection.error }}
        </p>
        <template v-if="connection.login">
          <p>Complete sign-in in your browser. <strong v-if="connection.login.code">Code: {{ connection.login.code }}</strong></p>
          <button :disabled="busy" @click="request({ type: 'openLogin', id: connection.id })">
            Open sign-in
          </button>
          <input aria-label="Sign-in address" readonly :value="connection.login.url">
        </template>
        <button v-if="connection.state === 'connecting'" :disabled="busy" @click="request({ type: 'cancel', id: connection.id })">
          Cancel sign-in
        </button>
        <button v-if="connection.state === 'ready' || connection.state === 'expired'" :disabled="busy" @click="request({ type: 'disconnect', id: connection.id })">
          Disconnect
        </button>
      </div>
      <form class="setup-form" @submit.prevent="connect">
        <label>Connection<select v-model="provider" aria-label="Connection"><option value="chatgpt">ChatGPT · model execution</option><option value="openape">OpenApe · pod permissions</option><option value="microsoft">Microsoft 365 · read-only mail</option></select></label>
        <label v-if="provider !== 'chatgpt'">Expected account<input v-model="account" type="email" required autocomplete="email"></label>
        <label v-if="provider === 'openape'">Identity provider<input v-model="issuer" type="url" required></label>
        <p>Credentials stay in the Mac’s protected connection store. Pods and the master chat receive no account tokens.</p>
        <button class="primary" :disabled="busy || !view?.runtime.ready">
          Start sign-in
        </button>
      </form>
    </article>
    <article class="card setup-form">
      <h2>Assign mail to {{ pod?.name || 'a pod' }}</h2>
      <p v-if="!pod">
        Create a paused pod in Settings or with the master chat, then return here.
      </p>
      <label>OpenApe owner<select v-model="ownerId" aria-label="OpenApe owner" @change="reviewed = false"><option value="">Choose owner identity</option><option v-for="item in owners" :key="item.id" :value="item.id">{{ item.account }}</option></select></label>
      <label>Microsoft account<select v-model="mailId" aria-label="Microsoft account" @change="folders = []; selected = []; reviewed = false"><option value="">Choose mail account</option><option v-for="item in mailAccounts" :key="item.id" :value="item.id">{{ item.account }}</option></select></label>
      <button :disabled="busy || !mailId" @click="request({ type: 'folders', id: mailId })">
        Load folder names
      </button>
      <fieldset v-if="folders.length" class="setup-folders">
        <legend>Folders this pod may read</legend>
        <label v-for="folder in folders" :key="folder.id"><input v-model="selected" type="checkbox" :value="folder.id" @change="reviewed = false">{{ folder.name }}</label>
      </fieldset>
      <label><input v-model="allHistory" type="checkbox" @change="reviewed = false">All available history</label>
      <label v-if="!allHistory">Read messages received on or after (UTC)<input v-model="since" type="date" required @change="reviewed = false"></label>
      <label><input v-model="attachments" type="checkbox" @change="reviewed = false">Read attachments of messages in the selected scope</label>
      <p>Only reads are assigned. Message text and selected attachment text may be sent to ChatGPT to produce sourced knowledge. Previously committed knowledge remains in this pod when its read scope changes.</p>
      <label><input v-model="reviewed" type="checkbox">I reviewed this account, folder selection, history and provider data use.</label>
      <button class="primary" :disabled="!canAssign" @click="assign">
        Review and assign read-only mail
      </button>
    </article>
    <article class="card">
      <h2>References and first run</h2>
      <p>Optional reference files become separate read-only snapshots for each run. Choose a validated script in Settings, then use Run once and inspect its sources. Enable a schedule separately after that review.</p>
      <button :disabled="!pod" @click="$emit('reference')">
        Choose a reference in Resources
      </button>
      <button :disabled="busy" @click="finish">
        Continue to workspace
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
