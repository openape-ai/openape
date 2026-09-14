<script setup lang="ts">
import { t, diagnostic, label } from './i18n'
import { chatDraft } from './chat-buffer'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'

const props = defineProps<{ podId: string | null }>()
const emit = defineEmits<{ resources: [podId: string] }>()
const view = ref<MasterView | null>(null); const text = chatDraft(props.podId); const error = ref(''); const busy = ref(false)
let closed = false; let timer: ReturnType<typeof setTimeout> | undefined
async function refresh(): Promise<void> {
  try { view.value = await window.pods.master({ type: 'list', podId: props.podId }) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load master chat' }
  if (!closed) timer = setTimeout(() => { void refresh() }, 500)
}
async function command(value: MasterCommand): Promise<void> {
  busy.value = true; error.value = ''
  try { view.value = await window.pods.master(value); if ((value.type === 'send' || value.type === 'steer') && text.value === value.text) text.value = '' }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Master request failed' }
  finally { busy.value = false }
}
async function send(): Promise<void> { await command({ type: view.value?.state === 'running' ? 'steer' : 'send', id: crypto.randomUUID(), text: text.value, podId: props.podId }) }
onMounted(() => { void refresh() }); onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <div class="master-chat">
    <p class="muted">
      {{ view?.connected ? t("Describe the task. Your assistant helps prepare the script and required access.") : t("Connect Codex to start a conversation. Your local history remains available.") }}
    </p>
    <p v-if="error || view?.error" role="alert" class="error-message">
      {{ diagnostic(error || view?.error) }}
    </p>
    <div class="master-history" role="log" :aria-label="t('Pod conversation')" aria-live="polite">
      <article v-for="message in view?.messages" :key="message.id" class="master-message" :class="message.role">
        <div class="card-heading">
          <strong>{{ message.role === 'user' ? t("You") : message.role === 'tool' ? t("Pod action") : t("Pod assistant") }}</strong><span class="badge">{{ label(message.state) }}</span>
        </div>
        <details v-if="message.role === 'tool'">
          <summary>{{ t("Inspect request and result") }}</summary><pre>{{ message.text }}</pre>
        </details><p v-else class="master-text">
          {{ message.text }}
        </p>
      </article>
      <p v-if="!view?.messages.length" class="muted">
        {{ t("Describe what your pod should learn or inspect an existing assignment.") }}
      </p>
    </div>
    <form class="master-compose" @submit.prevent="send">
      <label for="master-input">{{ view?.state === 'running' ? t("Steer the current turn") : t("Message this pod") }}</label>
      <textarea id="master-input" v-model="text" rows="3" maxlength="20000" :placeholder="t('Create a pod that keeps sourced knowledge about…')" />
      <div class="overview-actions">
        <span role="status" class="muted">{{ label(view?.state ?? t("Loading")) }}</span>
        <button v-if="view?.state === 'running'" type="button" class="secondary" :disabled="busy" @click="command({ type: 'cancel', podId: props.podId })">
          {{ t("Cancel turn") }}
        </button><button class="primary" :disabled="busy || !text.trim() || !view?.connected">
          {{ view?.state === 'running' ? t("Steer") : t("Send") }}
        </button>
      </div>
    </form>
    <section v-if="view?.drafts.length" :aria-label="t('Script drafts')">
      <h3>{{ t("Script drafts") }}</h3><details v-for="draft in view.drafts" :key="draft.id" class="master-message">
        <summary>{{ t("{p0} · revision {p1} · {p2}", { p0: draft.name, p1: draft.revision, p2: draft.validation ? t("Validated with synthetic services") : t("Unvalidated draft") }) }}</summary>
        <p class="muted">
          {{ t("Capabilities: {p0}", { p0: draft.capabilities.join(', ') || t("none") }) }}
        </p><pre>{{ draft.code }}</pre><p v-if="draft.validation" class="muted">
          {{ t("The script completed a bounded sandbox check with synthetic services. Real mail and model behavior still require verification.") }}
        </p><details v-if="draft.validation">
          <summary>{{ t("Validation details") }}</summary><pre>{{ draft.validation }}</pre>
        </details>
      </details>
    </section>
    <section v-if="view?.proposals.length" :aria-label="t('Access proposals')">
      <h3>{{ t("Resource access for your review") }}</h3><article v-for="proposal in view.proposals" :key="proposal.id" class="master-message">
        <p>{{ proposal.body.description }}</p><dl class="proposal-scope">
          <dt>{{ t("Service") }}</dt><dd>{{ proposal.body.provider === 'microsoft' ? t("Microsoft 365 · read only") : t("Reference file · read-only snapshots") }}</dd>
          <template v-if="proposal.body.account">
            <dt>{{ t("Account") }}</dt><dd>{{ proposal.body.account }}</dd>
          </template>
          <template v-if="proposal.body.folders">
            <dt>{{ t("Folders") }}</dt><dd>{{ (proposal.body.folders as string[]).join(', ') }}</dd>
          </template>
          <template v-if="proposal.body.attachments !== undefined">
            <dt>{{ t("Attachments") }}</dt><dd>{{ proposal.body.attachments ? t("Include readable attachments") : t("Do not read attachments") }}</dd>
          </template>
        </dl><span class="badge">{{ label(proposal.state) }}</span>
        <div v-if="proposal.state === 'pending'" class="overview-actions">
          <button class="secondary" @click="emit('resources', proposal.podId)">
            {{ t("Review resources") }}
          </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id, podId: props.podId })">
            {{ t("Decline") }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>
