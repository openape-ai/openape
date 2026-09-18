<script setup lang="ts">
import { t, diagnostic, label } from './i18n'
import { chatDraft } from './chat-buffer'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'

const props = defineProps<{ podId: string | null, creationId?: string }>()
const emit = defineEmits<{ resources: [podId: string], settings: [podId: string], created: [podId: string] }>()
const view = ref<MasterView | null>(null); const text = chatDraft(props.podId ?? props.creationId ?? null); const error = ref(''); const busy = ref(false)
const history = ref<HTMLElement>(); const input = ref<HTMLTextAreaElement>(); const followLatest = ref(true)
const messages = computed(() => {
  const first = view.value?.initialRequest
  const recent = view.value?.messages.filter(message => message.role !== 'tool' && message.id !== first?.id) ?? []
  return first ? [first, ...recent] : recent
})
const activity = computed(() => view.value?.messages.filter(message => message.role === 'tool') ?? [])
const canSend = computed(() => !busy.value && !!text.value.trim() && !!view.value?.connected)
function trackScroll(): void {
  const element = history.value
  if (element) followLatest.value = element.scrollHeight - element.scrollTop - element.clientHeight < 64
}
async function scrollToLatest(): Promise<void> {
  await nextTick()
  if (history.value && followLatest.value) history.value.scrollTop = history.value.scrollHeight
}
watch(() => JSON.stringify([messages.value, view.value?.state, view.value?.proposals, view.value?.drafts, activity.value, view.value?.error, error.value]), scrollToLatest)
watch(text, async () => {
  await nextTick()
  if (!input.value) return
  input.value.style.height = 'auto'
  input.value.style.height = `${Math.min(input.value.scrollHeight, 160)}px`
}, { immediate: true })
async function inputKey(event: KeyboardEvent): Promise<void> {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  await send()
}
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
async function send(): Promise<void> {
  if (!canSend.value) return
  followLatest.value = true
  await command({ type: view.value?.state === 'running' ? 'steer' : 'send', id: crypto.randomUUID(), text: text.value, podId: props.podId })
  await scrollToLatest()
}
onMounted(async () => {
  if (props.creationId) {
    try { await window.pods.master({ type: 'begin', id: props.creationId }) }
    catch (failure) { error.value = String(failure); return }
  }; await refresh()
}); onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <div class="master-chat">
    <div ref="history" class="chat-scroll" @scroll="trackScroll">
      <div class="chat-conversation">
        <p v-if="view && !view.connected" class="muted chat-notice">
          {{ t('Connect Codex to start a conversation. Your local history remains available.') }}
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

        <div class="master-history" role="log" :aria-label="t('Pod conversation')" aria-live="polite" aria-relevant="additions text">
          <article v-for="message in messages" :key="message.id" class="master-message" :class="message.role" :aria-label="message.role === 'user' ? t('You') : t('Pod assistant')">
            <p class="master-text">
              {{ message.text }}
            </p>
          </article>
        </div>
        <div v-if="view && !messages.length" class="chat-empty">
          <h2>{{ t('How can I help?') }}</h2>
          <p class="muted">
            {{ t('Describe what you would like to do.') }}
          </p>
        </div>
        <section v-if="view?.proposals.length" :aria-label="t('Access proposals')">
          <h3>{{ t("Resource access for your review") }}</h3><details v-for="proposal in view.proposals" :key="proposal.id" class="chat-access" :open="proposal.state === 'pending'">
            <summary>{{ proposal.body.description }}<span v-if="proposal.state !== 'pending'" class="muted"> · {{ label(proposal.state) }}</span></summary><dl class="proposal-scope">
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
            </dl>
            <div v-if="proposal.state === 'pending'" class="overview-actions">
              <button class="secondary" @click="proposal.body.provider === 'credential' ? emit('settings', proposal.podId) : emit('resources', proposal.podId)">
                {{ proposal.body.provider === 'credential' ? t('Variables and secrets') : t('Review resources') }}
              </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id, podId: props.podId })">
                {{ t("Decline") }}
              </button>
            </div>
          </details>
        </section>

        <details v-if="activity.length || view?.drafts.length" class="chat-details">
          <summary>{{ t('Technical details') }}</summary>
          <details v-for="message in activity" :key="message.id" class="chat-activity">
            <summary>{{ t('Inspect request and result') }} · {{ label(message.state) }}</summary>
            <pre>{{ message.text }}</pre>
          </details>
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
        </details>
        <slot />
        <p v-if="view?.state === 'running'" role="status" class="chat-status">
          {{ t('Thinking…') }}
        </p>
        <p v-else-if="view?.state === 'interrupted'" role="status" class="chat-status">
          {{ t('Response stopped.') }}
        </p>
      </div>
    </div>
    <form class="master-compose" @submit.prevent="send">
      <label for="master-input" class="chat-sr-only">{{ t('Message') }}</label>
      <textarea id="master-input" ref="input" v-model="text" rows="2" maxlength="20000" :placeholder="t('Write a message…')" @keydown="inputKey" />
      <div class="compose-actions">
        <span class="compose-hint">{{ t('Shift + Enter for a new line') }}</span>
        <button v-if="view?.state === 'running'" type="button" class="chat-stop" :disabled="busy" :aria-label="t('Stop response')" :title="t('Stop response')" @click="command({ type: 'cancel', podId: props.podId })">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
        </button>
        <button class="primary chat-send" :disabled="!canSend" :aria-label="t('Send')" :title="t('Send')">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.master-chat { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; }
.chat-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
.chat-conversation { max-width:760px; margin:0 auto; padding:16px 16px 28px; }
.master-history { display:flex; flex-direction:column; gap:28px; }
.master-message { min-width:0; max-width:100%; }
.master-message.user { align-self:flex-end; max-width:85%; padding:12px 18px; border-radius:22px; background:var(--sidebar); }
.master-message.assistant { padding:4px 0; }
.master-text { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:1.75; }
.chat-empty { text-align:center; padding:clamp(24px,10vh,100px) 0; }
.chat-empty h2 { font-size:26px; font-weight:500; margin:0 0 12px; }
.chat-notice, .chat-status { font-size:13px; color:var(--muted); }
.chat-status { margin:22px 0 0; }
.chat-details, .chat-access { margin:24px 0 0; font-size:13px; }
.chat-details > summary { color:var(--muted); }
.chat-activity, .chat-details section { margin-top:16px; }
.chat-details pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:300px; overflow:auto; font-size:12px; }
.chat-details .master-message { margin:12px 0; }
.chat-access { border:1px solid var(--border); border-radius:12px; padding:14px; }
.chat-access summary { line-height:1.6; }
.master-compose { width:calc(100% - 32px); max-width:728px; margin:12px auto 4px; flex-shrink:0; border:1px solid var(--border); background:var(--surface); border-radius:24px; padding:14px 16px 10px; box-shadow:0 2px 8px #00000008; }
.master-compose:focus-within { border-color:var(--accent); }
.master-compose textarea { display:block; width:100%; min-height:48px; max-height:160px; resize:none; padding:0; border:0; outline:none; background:transparent; color:inherit; font:inherit; font-size:15px; line-height:1.6; }
.compose-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:8px; }
.compose-hint { margin-right:auto; color:var(--muted); font-size:11px; }
.chat-send, .chat-stop { display:grid; place-items:center; width:36px; height:36px; padding:0; border-radius:50%; flex-shrink:0; }
.chat-stop { border:1px solid var(--border); background:transparent; color:inherit; cursor:pointer; }
.chat-send svg, .chat-stop svg { width:22px; height:22px; }
.chat-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media(max-width:760px) {
  .chat-conversation { padding:10px 6px 20px; }
  .master-compose { width:100%; padding:12px; border-radius:20px; }
  .master-message.user { max-width:92%; }
  .master-text { font-size:14px; }
  .compose-hint { font-size:10px; }
}
</style>
