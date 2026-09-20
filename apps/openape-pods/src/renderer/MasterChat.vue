<script setup lang="ts">
import { chatModels, parseChatModel } from '../contracts/models'
import type { ChatModel } from '../contracts/models'
import ChatSetupReview from './ChatSetupReview.vue'
import { t, diagnostic, label } from './i18n'
import { chatDraft } from './chat-buffer'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { MasterCommand, MasterView } from '../contracts/master'

const props = defineProps<{ podId: string | null, creationId?: string, conversationId?: string, bufferKey?: string }>()
const emit = defineEmits<{ resources: [podId: string], settings: [podId: string, alias?: string], created: [podId: string], openChat: [id: string], context: [id: string], run: [podId: string, runId: string], workflow: [id: string] }>()
const view = ref<MasterView | null>(null); const text = chatDraft(props.bufferKey ?? props.conversationId ?? props.podId ?? props.creationId ?? null); const error = ref(''); const busy = ref(false)
const model = ref<ChatModel>('gpt-5.5')
function chooseModel(): void {
  try { localStorage.setItem('pods-chat-model', model.value) }
  catch (failure) { error.value = String(failure) }
}
const history = ref<HTMLElement>(); const input = ref<HTMLTextAreaElement>(); const followLatest = ref(true)
const older = ref<MasterView['messages']>([]); const before = ref<number | null>(null)
const otherActive = computed(() => !!view.value?.activeConversationId && view.value.activeConversationId !== view.value.conversation?.id)
const messages = computed(() => {
  const first = view.value?.initialRequest
  const recent = [...older.value, ...view.value?.messages ?? []].filter(message => message.role !== 'tool' && message.id !== first?.id) ?? []
  return first ? [first, ...recent] : recent
})
const activity = computed(() => [...older.value, ...view.value?.messages ?? []].filter(message => message.role === 'tool'))
const canSend = computed(() => !busy.value && !!text.value.trim() && !!view.value?.connected && !otherActive.value)
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
async function load(): Promise<void> {
  const result = await window.pods.master({ type: 'list', podId: props.podId, ...(props.conversationId ? { conversationId: props.conversationId } : {}), ...(props.creationId ? { creationId: props.creationId } : {}) })
  if (older.value.length) older.value = [...older.value, ...view.value?.messages ?? []].filter((message, index, all) => all.findIndex(item => item.id === message.id) === index)
  older.value = older.value.filter(message => !result.messages.some(item => item.id === message.id))
  view.value = result; if (!older.value.length) before.value = result.nextBefore ?? null
  if (result.boundPodId) emit('created', result.boundPodId)
}
async function loadEarlier(): Promise<void> {
  if (!before.value) return
  try {
    const result = await window.pods.master({ type: 'list', podId: props.podId, ...(view.value?.conversation && !props.creationId ? { conversationId: view.value.conversation.id } : {}), before: before.value })
    older.value = [...result.messages, ...older.value]; before.value = result.nextBefore ?? null; followLatest.value = false
  }
  catch (failure) { error.value = String(failure) }
}
async function setupUpdated(): Promise<void> {
  try { await load() }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load master chat' }
}
async function resumeSetup(): Promise<void> {
  await command({ type: 'send', id: crypto.randomUUID(), podId: props.podId, model: model.value, text: t('Continue setting up this pod. Inspect what is saved, finish the requested script and ask me for any missing information. Leave existing schedules unchanged and do not run the script.') })
}
async function refresh(): Promise<void> {
  try { await load() }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load master chat' }
  if (!closed) timer = setTimeout(() => { void refresh() }, 500)
}
async function command(value: MasterCommand): Promise<void> {
  busy.value = true; error.value = ''
  try { view.value = await window.pods.master({ ...value, ...(view.value?.conversation && !props.creationId ? { conversationId: view.value.conversation.id, contextRevision: view.value.conversation.revision } : {}), ...(props.creationId ? { creationId: props.creationId } : {}) }); if ((value.type === 'send' || value.type === 'steer') && text.value === value.text) text.value = '' }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Master request failed' }
  finally { busy.value = false }
}
async function send(): Promise<void> {
  if (!canSend.value) return
  followLatest.value = true
  await command({ type: view.value?.state === 'running' ? 'steer' : 'send', id: crypto.randomUUID(), text: text.value, podId: props.podId, model: model.value })
  await scrollToLatest()
}
onMounted(async () => {
  try { const saved = localStorage.getItem('pods-chat-model'); if (saved) model.value = parseChatModel(saved) }
  catch (failure) { error.value = String(failure) }
  if (props.creationId) {
    try { await window.pods.master({ type: 'begin', id: props.creationId }) }
    catch (failure) { error.value = String(failure); return }
  }; await refresh()
}); onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
</script>

<template>
  <div class="master-chat">
    <div v-if="otherActive" role="status" class="chat-notice">
      {{ t('Another chat is running') }} <button class="text-button" @click="emit('openChat', view!.activeConversationId!)">
        {{ t('Open chat') }}
      </button>
    </div>
    <div v-if="view?.conversation && !conversationId" class="context-chips">
      <span v-if="view.conversation.context.workflow">{{ view.conversation.context.workflow.name }}</span><span v-for="pod in view.conversation.context.pods" :key="pod.id">{{ pod.name }}<span v-if="view.conversation.unavailablePodIds.includes(pod.id)"> · {{ t('Unavailable') }}</span></span><span v-if="view.conversation.workflowChanged">{{ t('Workflow changed. Use + to review its current members.') }}</span><span v-if="!view.conversation.context.pods.length">{{ t('Workspace context') }}</span>
    </div>
    <div class="chat-model">
      <label>{{ t('Chat model') }}<select v-model="model" :aria-label="t('Chat model')" :disabled="busy || view?.state === 'running'" @change="chooseModel"><option v-for="option in chatModels" :key="option.id" :value="option.id">{{ option.name }}</option></select></label>
    </div>
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

        <button v-if="before" class="text-button" @click="loadEarlier">
          {{ t('Load earlier messages') }}
        </button>
        <p v-if="(view?.conversation?.revision ?? 1) > 1" class="context-notice">
          {{ t('This context began with a fresh model session. Messages from earlier contexts stay readable here and are not sent again.') }}
        </p>
        <div class="master-history" role="log" :aria-label="t('Pod conversation')" aria-live="polite" aria-relevant="additions text">
          <article v-for="message in messages" :key="message.id" class="master-message" :class="message.role" :aria-label="message.role === 'user' ? t('You') : t('Pod assistant')">
            <small v-if="message.contextRevision" class="muted">{{ t('Context {p0}', { p0: message.contextRevision }) }}</small><p class="master-text">
              {{ message.text }}
            </p>
          </article>
        </div>
        <div v-if="view && !messages.length && !view.proposals.length && view.state === 'idle'" class="chat-empty">
          <h2>{{ t('How can I help?') }}</h2>
          <p class="muted">
            {{ t('Describe what you would like to do.') }}
          </p>
        </div>
        <section v-if="view?.scriptState && (view.state === 'interrupted' || view.state === 'failed' || view.scriptState === 'missing')" class="setup-status" role="status">
          <p>{{ t(view.scriptState === 'missing' ? 'No script has been saved for this pod yet.' : view.scriptState === 'draft' ? 'Your script draft is saved. Setup may still be incomplete.' : 'An active script is saved. The last conversation may be incomplete.') }}</p>
          <p v-if="view.state === 'interrupted'">
            {{ t('The response was interrupted. Saved settings are retained; announced changes may not have been saved.') }}
          </p>
        </section>
        <details v-if="view?.drafts.length" class="chat-access">
          <summary>{{ t('Saved Pod drafts') }}</summary><p v-for="draft in view.drafts" :key="draft.id">
            <strong>{{ draft.name }}</strong> · {{ t(draft.validation ? 'Validated with synthetic services' : 'Unvalidated draft') }}<span v-if="draft.validationError" class="error-message"> · {{ diagnostic(draft.validationError) }}</span>
          </p>
        </details>
        <section v-if="view?.changes?.length" :aria-label="t('Changes for review')">
          <h3>{{ t('Changes for review') }}</h3>
          <details v-for="change in view.changes" :key="change.id" class="chat-access" :open="change.state === 'pending'">
            <summary>{{ t(change.kind === 'run' ? 'Run once' : 'Saved changes') }} · {{ change.targets.map(target => target.name).join(', ') }} · {{ change.kind === 'run' && change.state === 'applied' ? t('Run requested') : label(change.state) }}</summary>
            <details v-if="change.workflow">
              <summary>{{ change.workflow.before.name }} · {{ t('Workflow changes') }}</summary><div class="change-columns">
                <section><h5>{{ t('Before') }}</h5><pre>{{ JSON.stringify(change.workflow.before, null, 2) }}</pre></section><section><h5>{{ t('Proposed') }}</h5><pre>{{ JSON.stringify(change.workflow.command, null, 2) }}</pre></section>
              </div>
            </details>
            <p v-if="change.error" role="alert" class="error-message">
              {{ diagnostic(change.error) }}
            </p>
            <p v-if="change.contextRevision !== view.conversation?.revision" class="muted">
              {{ t('Earlier context: inspect and prepare these changes again before applying.') }}
            </p>
            <article v-for="target in change.targets" :key="target.podId">
              <h4>{{ target.name }}</h4>
              <details v-for="(review, index) in target.review" :key="index" class="change-diff">
                <summary>{{ t(review.action.startsWith('setVariable') ? 'Change variable' : review.action === 'activate' ? 'Use script version' : review.action === 'rollback' ? 'Restore script version' : review.action === 'revise' ? 'Rename Pod' : review.action === 'setGroup' ? 'Change group' : review.action === 'prepareSchedule' ? 'Prepare disabled schedule' : review.action === 'pause' ? 'Pause Pod' : 'Run once') }}{{ review.action.includes(':') ? review.action.slice(review.action.indexOf(':')) : '' }}</summary>
                <div class="change-columns">
                  <section><h5>{{ t('Before') }}</h5><pre>{{ review.before || t('none') }}</pre></section><section><h5>{{ t('Proposed') }}</h5><pre>{{ review.after || t('none') }}</pre></section>
                </div>
                <details v-if="review.evidence">
                  <summary>{{ t('Validation details') }}</summary><pre>{{ review.evidence }}</pre>
                </details>
              </details>
              <p v-if="change.state === 'applied' && change.kind !== 'run'">
                {{ t(target.changedSinceApply ? 'Applied then; configuration changed later' : 'Applied with a saved receipt') }}
              </p>
              <div v-for="execution in change.execution?.filter(item => item.podId === target.podId)" :key="execution.runId ?? execution.podId" class="run-receipt">
                <strong>{{ label(execution.state) }}</strong><p v-if="execution.error" class="error-message">
                  {{ diagnostic(execution.error) }}
                </p><button v-if="execution.runId" class="text-button" @click="emit('run', execution.podId, execution.runId)">
                  {{ t('View run trace') }}
                </button><button v-else-if="execution.workflowId" class="text-button" @click="emit('workflow', execution.workflowId!)">
                  {{ t('Open workflow') }}
                </button>
              </div>
              <details v-if="change.results.some(result => result.podId === target.podId)">
                <summary>{{ t('Receipt') }}</summary><pre>{{ JSON.stringify(change.results.filter(result => result.podId === target.podId), null, 2) }}</pre>
              </details>
            </article>
            <div v-if="change.state === 'pending' && change.contextRevision === view.conversation?.revision" class="overview-actions">
              <button class="primary" :disabled="busy || !!view.activeConversationId" @click="command({ type: 'applyChanges', id: change.id, revision: change.revision })">
                {{ t(change.kind === 'run' ? 'Run once' : 'Apply changes together') }}
              </button><button class="secondary" :disabled="busy" @click="command({ type: 'discardChanges', id: change.id, revision: change.revision })">
                {{ t('Discard changes') }}
              </button>
            </div>
          </details>
        </section>
        <section v-if="view?.proposals.length" :aria-label="t('Access proposals')">
          <h3>{{ t("Resource access for your review") }}</h3><details v-for="proposal in view.proposals" :key="proposal.id" class="chat-access" :open="proposal.state === 'pending'">
            <summary>{{ proposal.body.description }}<span v-if="proposal.state !== 'pending'" class="muted"> · {{ label(proposal.state) }}</span></summary><dl class="proposal-scope">
              <dt>{{ t("Service") }}</dt><dd>{{ proposal.body.provider === 'credential' ? t('Secrets') : proposal.body.provider === 'directory' ? t('Directory permissions') : proposal.body.provider === 'reference' ? t('Files and folders') : proposal.body.provider === 'variable' ? t('Variables') : proposal.body.provider === 'http' ? t('HTTP destinations') : t('Executable applications') }}</dd>
              <template v-if="proposal.body.alias">
                <dt>{{ t(proposal.body.provider === 'variable' ? 'Variable name' : 'Secret name') }}</dt><dd>{{ proposal.body.alias }}</dd>
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
            <p v-if="proposal.body.instructions" class="master-text">
              {{ proposal.body.instructions }}
            </p>
            <p v-else-if="proposal.body.provider === 'credential' && proposal.body.alias === 'telegram_bot_token'" class="master-text">
              {{ t('In Telegram, open @BotFather. Use /newbot to create a bot or /mybots to select an existing bot and its API token. Save the token only in Variables and secrets, never in this chat. Then open your bot and send /start.') }}
            </p>
            <div v-if="proposal.state === 'pending'" class="overview-actions">
              <ChatSetupReview v-if="['http', 'directory', 'reference', 'application', 'variable'].includes(proposal.body.provider)" :proposal="proposal" @updated="setupUpdated" />
              <button v-else class="secondary" @click="proposal.body.provider === 'credential' ? emit('settings', proposal.podId, proposal.body.alias) : emit('resources', proposal.podId)">
                {{ proposal.body.provider === 'credential' ? t('Variables and secrets') : t('Review resources') }}
              </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id, podId: proposal.podId })">
                {{ t("Decline") }}
              </button>
            </div>
          </details>
        </section>

        <button v-if="view?.scriptState && view.state !== 'running' && (view.state === 'interrupted' || view.state === 'failed' || view.scriptState === 'missing' || view.proposals.length)" class="secondary" :disabled="busy || !view.connected" @click="resumeSetup">
          {{ t('Continue setup') }}
        </button>
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
        <button v-if="view?.conversation && !creationId" type="button" class="chat-add-context" :aria-label="t('Add context')" :title="t('Add context')" :disabled="busy || !!view.activeConversationId" @click="emit('context', view.conversation.id)">
          +
        </button>
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
.chat-add-context { flex:none; width:34px; height:34px; padding:0; border:0; border-radius:50%; background:var(--sidebar); color:var(--text); font-size:26px; cursor:pointer; line-height:1; }
.chat-add-context:disabled { opacity:.5; cursor:default; }
.change-columns { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.change-columns section { min-width:0; }
.change-diff { margin:10px 0; }
@media(max-width:760px) { .change-columns { grid-template-columns:1fr; } }
.context-chips { display:flex; flex-wrap:wrap; gap:8px; padding:6px 24px; color:var(--muted); font-size:13px; }
.context-notice { font-size:13px; color:var(--muted); line-height:1.5; }
.chat-access pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; }
.chat-model { padding:8px 24px; flex:none; }
.chat-model label { display:flex; align-items:center; flex-wrap:wrap; gap:10px; color:var(--muted); font-size:13px; }
.chat-model select { max-width:100%; padding:6px 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font:inherit; }
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
