<script lang="ts">
import { defineComponent } from 'vue'
import type { OnboardingCommand, OnboardingView } from '../contracts/onboarding'
import { t, diagnostic, label } from './i18n'

export default defineComponent({
  props: { podId: { type: String, required: true } },
  emits: ['accounts'],
  data() { return { view: null as OnboardingView | null, busy: false, error: '', loadError: '', brokerReview: false, brokerRevoking: false, brokerIssuer: 'https://pods.openape.ai', brokerDomain: 'pods.openape.ai', closed: false, timer: null as ReturnType<typeof setTimeout> | null } },
  computed: {
    identity() { return this.view?.podIdentity },
    owner() { return this.view?.connections.find(item => item.id === this.identity?.ownerConnection) },
    providerRevoked(): boolean { return !!this.identity?.bound && !!this.identity.brokerConnectionId && this.identity.brokerConnectionId !== this.owner?.broker?.connectionId },
  },
  async mounted() { await this.request(); this.poll() },
  beforeUnmount() { this.closed = true; if (this.timer) clearTimeout(this.timer) },
  methods: {
    t, diagnostic, label,
    poll() { if (this.closed) return; this.timer = setTimeout(async () => { if (!this.busy) await this.request(); this.poll() }, 1000) },
    async request(command?: OnboardingCommand) {
      if (this.busy) return
      this.busy = true
      if (command) this.error = ''
      try {
        if (command) await window.pods.onboarding(command)
        this.view = await window.pods.onboarding({ type: 'list', podId: this.podId })
        this.loadError = ''
        if (command) { this.brokerReview = false; this.brokerRevoking = false }
      }
      catch (error) { const message = error instanceof Error ? error.message : 'Could not load pod identity'; if (command) this.error = message; else this.loadError = message }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card pod-identity" :aria-label="t('Pod identity')">
    <h2>{{ t('Pod identity') }}</h2>
    <p v-if="error || loadError" role="alert" class="error-message">
      {{ diagnostic(error || loadError) }}
    </p>
    <template v-if="identity && !loadError">
      <template v-if="owner">
        <dl>
          <dt>{{ t('Agent identity') }}</dt>
          <dd>{{ identity.subject || t('Not created yet') }}</dd>
          <dt>{{ t('Permission decisions') }}</dt>
          <dd>{{ owner.account }} · {{ owner.state === 'ready' ? t('Signed in') : label(owner.state) }}</dd>
        </dl>
        <p v-if="!identity.subject">
          {{ t('This identity is created when you first review permissions for this pod.') }}
        </p>
        <p v-if="!identity.bound" class="muted">
          {{ t('This pod will use your default DDISA account. Once assigned, its identity and owner stay fixed.') }}
        </p>
        <p v-if="owner.state !== 'ready'" role="alert">
          {{ t('Sign in to this pod’s assigned DDISA account again in Your accounts.') }}
        </p>
        <p v-if="providerRevoked" role="alert">
          {{ t('The provider consent for this pod was revoked or replaced. A new consent does not restore this identity or its grants.') }}
        </p>
        <button class="text-button" @click="$emit('accounts')">
          {{ t('Manage your accounts') }}
        </button>
        <details>
          <summary>{{ t('Identity details') }}</summary>
          <dl>
            <dt>{{ t('Agent identity provider') }}</dt><dd>{{ identity.issuer || t('Not set') }}</dd>
            <dt>{{ t('Decision identity provider') }}</dt><dd>{{ identity.decisionIssuer || t('Not set') }}</dd>
          </dl>
          <p v-if="identity.bound">
            {{ t('This pod keeps its assigned identity, even if you change your default account or allow requests from another provider.') }}
          </p>
        </details>
        <details v-if="owner.state === 'ready'" class="provider-settings">
          <summary>{{ t('Agent provider permission') }}</summary>
          <p>{{ t('This permission belongs to your DDISA account and applies across its pods. The provider may submit requests; you decide which actions to approve.') }}</p>
          <template v-if="owner.broker">
            <p>{{ t('Agent provider: {p0}', { p0: owner.broker.domain }) }}</p>
            <button :disabled="busy" @click="brokerRevoking = true">
              {{ t('Revoke provider permission') }}
            </button>
            <div v-if="brokerRevoking" class="provider-review">
              <p>{{ t('Revoking this provider blocks new requests and further use of its grants, including existing recurring permissions. Existing pod identities and data are retained.') }}</p>
              <p>{{ t('This affects all pods using this account’s provider consent.') }}</p>
              <button :disabled="busy" @click="request({ type: 'revokeBroker', id: owner.id })">
                {{ t('Confirm revocation') }}
              </button>
              <button :disabled="busy" @click="brokerRevoking = false">
                {{ t('Cancel') }}
              </button>
            </div>
          </template>
          <template v-else>
            <p>{{ t('No separate agent provider has permission yet. New identities are created at your DDISA identity provider.') }}</p>
            <p>{{ t('You grant this permission with your DDISA account. No additional sign-in at the agent provider is needed.') }}</p>
            <button :disabled="busy" @click="brokerReview = true">
              {{ t('Allow requests from this provider') }}
            </button>
            <form v-if="brokerReview" class="provider-review" @submit.prevent="request({ type: 'enableBroker', id: owner.id, issuer: brokerIssuer, domain: brokerDomain })">
              <p>{{ t('Allow this provider to create agent identities for you and submit permission requests to your account? It cannot approve actions. This applies to new pod identities; existing pods keep their assigned provider.') }}</p>
              <label>{{ t('Agent provider') }}<input v-model="brokerIssuer" type="url" required></label>
              <label>{{ t('Agent identity domain') }}<input v-model="brokerDomain" required></label>
              <p>{{ t('Decisions remain with {p0}.', { p0: owner.account }) }}</p>
              <button class="primary" :disabled="busy">
                {{ t('Confirm permission') }}
              </button>
              <button type="button" :disabled="busy" @click="brokerReview = false">
                {{ t('Cancel') }}
              </button>
            </form>
          </template>
        </details>
      </template>
      <template v-else>
        <p>{{ t('Connect your DDISA account and choose it for new pods before creating this pod’s identity.') }}</p>
        <button @click="$emit('accounts')">
          {{ t('Open your accounts') }}
        </button>
      </template>
    </template>
  </article>
</template>

<style scoped>
.pod-identity { overflow-wrap: anywhere; }
dl { display: grid; gap: 6px; }
dt { color: var(--muted); margin-top: 10px; }
dd { margin: 0; }
details { margin-top: 16px; }
.provider-review { border-left: 3px solid var(--border); padding-left: 12px; margin-top: 12px; }
label { display: grid; gap: 6px; margin: 12px 0; }
input { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; }
button { margin: 4px 8px 4px 0; }
</style>
