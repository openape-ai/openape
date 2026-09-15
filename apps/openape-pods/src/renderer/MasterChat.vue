<script setup lang="ts">
import { t, diagnostic, label, dateTime } from './i18n'
import { chatDraft } from './chat-buffer'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'

const props = defineProps<{ podId: string | null, creationId?: string }>()
const emit = defineEmits<{ resources: [podId: string], settings: [podId: string], created: [podId: string] }>()
const view = ref<MasterView | null>(null); const text = chatDraft(props.podId ?? props.creationId ?? null); const error = ref(''); const busy = ref(false)
let closed = false; let timer: ReturnType<typeof setTimeout> | undefined
async function refresh(): Promise<void> {
  try { view.value = await window.pods.master({ type: 'list', podId: props.podId, ...(props.creationId ? { creationId: props.creationId } : {}) }); if (view.value.boundPodId) emit('created', view.value.boundPodId) }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load master chat' }
  if (!closed) timer = setTimeout(() => { void refresh() }, 500)
}
async function command(value: MasterCommand): Promise<void> {
  busy.value = true; error.value = ''
  try { view.value = await window.pods.master({ ...value, ...(props.creationId ? { creationId: props.creationId } : {}) }); if ((value.type === 'send' || value.type === 'steer') && text.value === value.text) text.value = '' }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Master request failed' }
  finally { busy.value = false }
}
async function send(): Promise<void> { await command({ type: view.value?.state === 'running' ? 'steer' : 'send', id: crypto.randomUUID(), text: text.value, podId: props.podId }) }
onMounted(async () => {
  if (props.creationId) {
    try { await window.pods.master({ type: 'begin', id: props.creationId }) }
    catch (failure) { error.value = String(failure); return }
  }; await refresh()
}); onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <div class="master-chat">
    <p class="muted">
      {{ view?.connected ? t("Describe the task. Your assistant helps prepare the script and required access.") : t("Connect Codex to start a conversation. Your local history remains available.") }}
    </p>
    <p v-if="error || view?.error" role="alert" class="error-message">
      {{ diagnostic(error || view?.error) }}
    </p>
    <section v-if="view?.adoption && podId" class="card">
      <h3>{{ t('Recover creation chat') }}</h3><p>{{ t('These original requests can be linked to this pod. Review them before continuing.') }}</p>
      <details>
        <summary>{{ t('Review original requests') }}</summary><p v-for="request in view.adoption.requests" :key="request.id" class="master-text">
          {{ request.text }}
        </p>
      </details>
      <button :disabled="busy" @click="command({ type: 'adopt', podId, hash: view.adoption.hash })">
        {{ t('Link this history to the pod') }}
      </button>
    </section>
    <article v-if="view?.initialRequest" class="start-request" :aria-label="t('Start request')">
      <div class="card-heading">
        <strong>{{ t('Start request') }}</strong><time>{{ dateTime(view.initialRequest.at) }}</time>
      </div>
      <p class="muted">
        {{ t('Your original request. Later changes remain in the conversation below.') }}
      </p>
      <details v-if="view.initialRequest.text.length > 800">
        <summary>{{ t('Show original request') }}</summary><p class="master-text">
          {{ view.initialRequest.text }}
        </p>
      </details>
      <p v-else class="master-text">
        {{ view.initialRequest.text }}
      </p>
    </article>
    <div class="master-history" role="log" :aria-label="t('Pod conversation')" aria-live="polite">
      <article v-for="message in view?.messages.filter(item => item.id !== view?.initialRequest?.id)" :key="message.id" class="master-message" :class="message.role">
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
        {{ t("Describe what your pod should do or inspect its current script.") }}
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
          <dt>{{ t("Service") }}</dt><dd>{{ proposal.body.provider === 'credential' ? t('Secrets') : proposal.body.provider === 'reference' ? t("Reference file · read-only snapshots") : proposal.body.provider === 'http' ? t('HTTP destinations') : t('Executable applications') }}</dd>
          <template v-if="proposal.body.alias">
            <dt>{{ t('Secret name') }}</dt><dd>{{ proposal.body.alias }}</dd>
          </template>
          <template v-if="proposal.body.application">
            <dt>{{ t('Application') }}</dt><dd>{{ proposal.body.application }}</dd>
          </template>
          <template v-if="proposal.body.command">
            <dt>{{ t('Program arguments') }}</dt><dd>{{ proposal.body.command }}</dd>
          </template>
          <template v-if="proposal.body.origin">
            <dt>{{ t('HTTPS origin') }}</dt><dd>{{ proposal.body.origin }}</dd>
          </template>
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
          <button class="secondary" @click="proposal.body.provider === 'credential' ? emit('settings', proposal.podId) : emit('resources', proposal.podId)">
            {{ proposal.body.provider === 'credential' ? t('Open Settings') : t('Review resources') }}
          </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id, podId: props.podId })">
            {{ t("Decline") }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>
