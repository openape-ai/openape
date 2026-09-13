<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'

const props = defineProps<{ podId: string | null }>()
const emit = defineEmits<{ resources: [podId: string] }>()
const view = ref<MasterView | null>(null); const text = ref(''); const error = ref(''); const busy = ref(false)
let closed = false; let timer: ReturnType<typeof setTimeout> | undefined
async function refresh(): Promise<void> {
  try { view.value = await window.pods.master({ type: 'list' }) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load master chat' }
  if (!closed) timer = setTimeout(() => { void refresh() }, 500)
}
async function command(value: MasterCommand): Promise<void> {
  busy.value = true; error.value = ''
  try { view.value = await window.pods.master(value); if (value.type === 'send' || value.type === 'steer') text.value = '' }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Master request failed' }
  finally { busy.value = false }
}
async function send(): Promise<void> { await command({ type: view.value?.state === 'running' ? 'steer' : 'send', id: crypto.randomUUID(), text: text.value, podId: props.podId }) }
onMounted(() => { void refresh() }); onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <div class="master-chat">
    <p class="muted">
      {{ view?.connected ? 'Your master can configure pods within their assigned permissions.' : 'Connect Codex to start a conversation. Your local history remains available.' }}
    </p>
    <p v-if="error || view?.error" role="alert" class="error-message">
      {{ error || view?.error }}
    </p>
    <div class="master-history" role="log" aria-label="Master conversation" aria-live="polite">
      <article v-for="message in view?.messages" :key="message.id" class="master-message" :class="message.role">
        <div class="card-heading">
          <strong>{{ message.role === 'user' ? 'You' : message.role === 'tool' ? 'Pod action' : 'Master' }}</strong><span class="badge">{{ message.state }}</span>
        </div>
        <details v-if="message.role === 'tool'">
          <summary>Inspect request and result</summary><pre>{{ message.text }}</pre>
        </details><p v-else class="master-text">
          {{ message.text }}
        </p>
      </article>
      <p v-if="!view?.messages.length" class="muted">
        Describe what your pod should learn or inspect an existing assignment.
      </p>
    </div>
    <form class="master-compose" @submit.prevent="send">
      <label for="master-input">{{ view?.state === 'running' ? 'Steer the current turn' : 'Message the master' }}</label>
      <textarea id="master-input" v-model="text" rows="3" maxlength="20000" placeholder="Create a pod that keeps sourced knowledge about…" />
      <div class="overview-actions">
        <span role="status" class="muted">{{ view?.state ?? 'Loading' }}</span>
        <button v-if="view?.state === 'running'" type="button" class="secondary" :disabled="busy" @click="command({ type: 'cancel' })">
          Cancel turn
        </button><button class="primary" :disabled="busy || !text.trim() || !view?.connected">
          {{ view?.state === 'running' ? 'Steer' : 'Send' }}
        </button>
      </div>
    </form>
    <section v-if="view?.drafts.length" aria-label="Script drafts">
      <h3>Script drafts</h3><details v-for="draft in view.drafts" :key="draft.id" class="master-message">
        <summary>{{ draft.name }} · revision {{ draft.revision }} · {{ draft.validation ? 'Validated with synthetic services' : 'Unvalidated draft' }}</summary>
        <p class="muted">
          Capabilities: {{ draft.capabilities.join(', ') || 'none' }}
        </p><pre>{{ draft.code }}</pre><p v-if="draft.validation" class="muted">
          The script completed a bounded sandbox check with synthetic services. Real mail and model behavior still require verification.
        </p><details v-if="draft.validation">
          <summary>Validation details</summary><pre>{{ draft.validation }}</pre>
        </details>
      </details>
    </section>
    <section v-if="view?.proposals.length" aria-label="Access proposals">
      <h3>Resource access for your review</h3><article v-for="proposal in view.proposals" :key="proposal.id" class="master-message">
        <p>{{ proposal.body.description }}</p><dl class="proposal-scope">
          <dt>Service</dt><dd>{{ proposal.body.provider === 'microsoft' ? 'Microsoft 365 · read only' : 'Reference file · read-only snapshots' }}</dd>
          <template v-if="proposal.body.account">
            <dt>Account</dt><dd>{{ proposal.body.account }}</dd>
          </template>
          <template v-if="proposal.body.folders">
            <dt>Folders</dt><dd>{{ (proposal.body.folders as string[]).join(', ') }}</dd>
          </template>
          <template v-if="proposal.body.attachments !== undefined">
            <dt>Attachments</dt><dd>{{ proposal.body.attachments ? 'Include readable attachments' : 'Do not read attachments' }}</dd>
          </template>
        </dl><span class="badge">{{ proposal.state }}</span>
        <div v-if="proposal.state === 'pending'" class="overview-actions">
          <button class="secondary" @click="emit('resources', proposal.podId)">
            Review resources
          </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id })">
            Decline
          </button>
        </div>
      </article>
    </section>
  </div>
</template>
