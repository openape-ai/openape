<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
import type { ChatsView, ChatsCommand } from '../contracts/chats'
import type { StoredPod } from '../contracts/control'
import type { WorkflowView } from '../contracts/workflows'
import MasterChat from './MasterChat.vue'
import { t, diagnostic, dateTime } from './i18n'

const props = defineProps<{ view: ChatsView, pods: StoredPod[], workflows: WorkflowView, selectedId: string, initialPodId?: string, initialWorkflowId?: string, initialEdit?: boolean }>()
const emit = defineEmits<{ select: [id: string], changed: [view: ChatsView], resources: [podId: string], settings: [podId: string, alias?: string], pod: [id: string], workflow: [id: string], run: [podId: string, runId: string] }>()
const conversation = computed(() => props.view.conversations.find(chat => chat.id === props.selectedId))
const detached = ref(''); const picker = ref<HTMLDialogElement>(); const editing = ref(false); const creating = ref(false); const title = ref(''); const podIds = ref<string[]>([]); const workflowId = ref(''); const error = ref(''); const busy = ref(false)
const choices = ref(props.workflows.workflows); const editingRevision = ref(1)
const workflow = computed(() => choices.value.find(item => item.id === workflowId.value))
const effective = computed(() => [...new Set([...podIds.value, ...workflow.value?.nodes.map(node => node.podId) ?? []])])
const workflowRefresh = computed(() => conversation.value?.context.workflow?.id === workflow.value?.id && conversation.value?.context.workflow?.revision !== workflow.value?.revision)
const added = computed(() => effective.value.filter(id => !conversation.value?.context.pods.some(pod => pod.id === id)).map(id => props.pods.find(pod => pod.id === id)?.name ?? id))
const removed = computed(() => conversation.value?.context.pods.filter(pod => !effective.value.includes(pod.id)) ?? [])
async function edit(create = false): Promise<void> {
  choices.value = JSON.parse(JSON.stringify(props.workflows.workflows)) as WorkflowView['workflows']; editingRevision.value = conversation.value?.revision ?? 1
  detached.value = ''; creating.value = create; title.value = create ? t('New chat') : conversation.value?.title ?? ''
  podIds.value = create ? [] : [...conversation.value?.context.podIds ?? []]
  workflowId.value = create ? '' : conversation.value?.context.workflow?.id ?? ''; editing.value = true; error.value = ''
  await nextTick(); picker.value?.showModal()
}
function closeEditor(): void { picker.value?.close(); editing.value = false }
async function removeContext(podId?: string): Promise<void> {
  await edit()
  if (!podId) {
    workflowId.value = ''
  }
  else {
    if (workflow.value?.nodes.some(node => node.podId === podId)) { detached.value = workflow.value.name; podIds.value = effective.value.filter(id => id !== podId); workflowId.value = '' }
    else {
      podIds.value = podIds.value.filter(id => id !== podId)
    }
  }
}
async function command(command: ChatsCommand): Promise<boolean> {
  busy.value = true; error.value = ''
  try { emit('changed', await window.pods.chats(command)); return true }
  catch (failure) { error.value = String(failure); return false }
  finally { busy.value = false }
}
async function createChat(): Promise<void> {
  const id = crypto.randomUUID()
  if (await command({ type: 'create', id, title: t('New chat'), podIds: [], workflowId: null, workflowRevision: null })) emit('select', id)
}
async function save(): Promise<void> {
  const id = creating.value ? crypto.randomUUID() : props.selectedId
  const context = { podIds: [...podIds.value], workflowId: workflow.value?.id ?? null, workflowRevision: workflow.value?.revision ?? null }
  if (!creating.value && conversation.value?.revision === editingRevision.value && JSON.stringify([...context.podIds].sort()) === JSON.stringify([...conversation.value.context.podIds].sort()) && context.workflowId === (conversation.value.context.workflow?.id ?? null) && context.workflowRevision === (conversation.value.context.workflow?.revision ?? null)) { closeEditor(); return }
  const request: ChatsCommand = creating.value ? { type: 'create', id, title: title.value, ...context } : { type: 'context', id, revision: editingRevision.value, ...context }
  if (await command(request)) { closeEditor(); emit('select', id) }
}
async function rename(): Promise<void> {
  if (!conversation.value) return
  await command({ type: 'rename', id: conversation.value.id, revision: conversation.value.revision, title: title.value })
}
onMounted(async () => {
  if (props.initialEdit) {
    await edit()
  }
  else if (props.initialPodId || props.initialWorkflowId) { await edit(true); podIds.value = props.initialPodId ? [props.initialPodId] : []; workflowId.value = props.initialWorkflowId ?? '' }
})
</script>

<template>
  <section class="chats-panel">
    <div v-if="!conversation || editing" class="chats-toolbar">
      <button v-if="!editing" class="primary" @click="createChat">
        {{ t('New chat') }}
      </button>
      <button v-if="conversation && !editing" class="text-button" @click="emit('select', '')">
        {{ t('All chats') }}
      </button>
    </div>
    <p v-if="error && !editing" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <dialog ref="picker" class="context-picker" :aria-label="t(creating ? 'New chat' : 'Add context')" @cancel.prevent="closeEditor" @close="editing = false">
      <form class="context-editor" @submit.prevent="save">
        <p v-if="error" role="alert" class="error-message">
          {{ diagnostic(error) }}
        </p>
        <h2>{{ t(creating ? 'New chat' : 'Add context') }}</h2>
        <label v-if="creating">{{ t('Chat title') }}<input v-model="title" required maxlength="100"></label>
        <label>{{ t('Workflow context') }}<select v-model="workflowId"><option value="">{{ t('No workflow') }}</option><option v-for="item in choices" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <p v-if="workflow">
          {{ t('Workflow members are included as a snapshot. Later changes require your review.') }}
        </p>
        <fieldset><legend>{{ t('Directly selected Pods') }}</legend><label v-for="pod in pods.filter(pod => pod.lifecycle !== 'archived')" :key="pod.id" class="context-choice"><input v-model="podIds" type="checkbox" :value="pod.id">{{ pod.name }}<span v-if="workflow?.nodes.some(node => node.podId === pod.id)" class="muted"> · {{ t('Workflow member') }}</span></label></fieldset>
        <p>{{ t('Selected Pods: {p0}', { p0: effective.length }) }}</p>
        <p v-if="detached" class="context-notice">
          {{ t('Removing a workflow member detaches the workflow. The remaining Pods stay selected.') }}
        </p>
        <p v-if="added.length">
          {{ t('Added to future model context') }}: {{ added.join(', ') }}
        </p>
        <details v-if="workflowRefresh" class="workflow-context-diff">
          <summary>{{ t('Review workflow changes') }}</summary>
          <strong>{{ t('Previous workflow') }}</strong><pre>{{ JSON.stringify(conversation?.context.workflow, null, 2) }}</pre>
          <strong>{{ t('Current workflow') }}</strong><pre>{{ JSON.stringify(workflow, null, 2) }}</pre>
        </details>
        <p v-if="removed.length">
          {{ t('Removed from future model context') }}: {{ removed.map(pod => pod.name).join(', ') }}
        </p>
        <p v-if="!creating" class="context-notice">
          {{ t('Context changes start fresh; your history stays readable.') }}
        </p>
        <div class="overview-actions">
          <button class="primary" :disabled="busy || !!view.activeConversationId || effective.length > 32">
            {{ t(creating ? 'Create chat' : 'Confirm context') }}
          </button><button type="button" class="secondary" @click="closeEditor">
            {{ t('Cancel') }}
          </button>
        </div>
      </form>
    </dialog>
    <template v-if="conversation">
      <header class="conversation-header">
        <div class="overview-actions">
          <button class="text-button" @click="emit('select', '')">
            {{ t('All chats') }}
          </button><strong>{{ conversation.title }}</strong><button class="text-button" @click="createChat">
            {{ t('New chat') }}
          </button>
        </div>
        <details>
          <summary>{{ t('Rename chat') }}</summary><form class="overview-actions" @submit.prevent="rename">
            <input v-model="title" :placeholder="conversation.title" :aria-label="t('Chat title')" required maxlength="100"><button :disabled="busy">
              {{ t('Save') }}
            </button>
          </form>
        </details>
        <div class="context-chips">
          <span v-if="conversation.context.workflow" class="context-chip"><button @click="emit('workflow', conversation.context.workflow.id)">{{ conversation.context.workflow.name }}</button><button :disabled="!!view.activeConversationId" :aria-label="t('Remove {p0} from context', { p0: conversation.context.workflow.name })" @click="removeContext()">×</button></span>
          <span v-for="pod in conversation.context.pods" :key="pod.id" class="context-chip"><button :disabled="conversation.unavailablePodIds.includes(pod.id)" @click="emit('pod', pod.id)">{{ pod.name }}<span v-if="conversation.unavailablePodIds.includes(pod.id)"> · {{ t('Unavailable') }}</span></button><button :disabled="!!view.activeConversationId" :aria-label="t('Remove {p0} from context', { p0: pod.name })" @click="removeContext(pod.id)">×</button></span>
          <span v-if="!conversation.context.pods.length" class="muted">{{ t('Workspace context') }}</span>
        </div>
        <p v-if="conversation.workflowChanged" role="status" class="context-notice">
          {{ t('Workflow changed. Use + to review its current members.') }}
        </p>
      </header>
      <MasterChat :key="`${conversation.id}:${conversation.revision}`" :conversation-id="conversation.id" :buffer-key="conversation.originPodId ?? conversation.id" :pod-id="null" @run="(podId, runId) => emit('run', podId, runId)" @workflow="emit('workflow', $event)" @context="edit()" @resources="emit('resources', $event)" @settings="(id, alias) => emit('settings', id, alias)" @open-chat="emit('select', $event)" />
    </template>
    <ul v-else class="conversation-list">
      <li v-for="chat in view.conversations" :key="chat.id">
        <button class="conversation-row" @click="emit('select', chat.id)">
          <strong>{{ chat.title }}</strong><span>{{ chat.context.workflow?.name ?? (chat.context.pods.map(pod => pod.name).join(', ') || t('Workspace context')) }}</span><small>{{ dateTime(chat.updatedAt) }}</small>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.workflow-context-diff pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; }
.context-picker { width:min(520px, calc(100vw - 32px)); max-height:calc(100vh - 48px); padding:24px; border:1px solid var(--border); border-radius:20px; color:var(--text); background:var(--surface); box-shadow:0 18px 70px #0003; }
.context-picker::backdrop { background:#0004; }
.context-chip { display:inline-flex; max-width:100%; align-items:center; border:1px solid var(--border); border-radius:18px; background:var(--surface); }
.context-chip button { border:0; background:transparent; color:inherit; padding:7px 10px; font:inherit; cursor:pointer; }
.context-chip button + button { border-left:1px solid var(--border); color:var(--muted); font-size:18px; }

.chats-panel { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; }
.chats-toolbar, .conversation-header { flex:none; padding:10px 0; }
.conversation-header { border-bottom:1px solid var(--border); }
.conversation-header details { margin:6px 0; font-size:12px; color:var(--muted); }
.context-chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.context-chips button { max-width:100%; overflow-wrap:anywhere; }
.context-editor { overflow:auto; }
.context-editor > label { display:grid; gap:8px; margin-bottom:16px; }
.context-editor input:not([type=checkbox]), .context-editor select { max-width:100%; padding:10px; }
.context-editor fieldset { border:1px solid var(--border); border-radius:10px; max-height:240px; overflow:auto; }
.context-choice { display:flex; gap:8px; align-items:center; margin:10px 0; }
.context-notice { color:var(--muted); font-size:13px; line-height:1.6; }
.conversation-list { list-style:none; margin:0; padding:0; overflow:auto; }
.conversation-row { width:100%; display:grid; text-align:left; gap:8px; padding:18px 12px; background:transparent; color:inherit; border:0; border-bottom:1px solid var(--border); cursor:pointer; overflow-wrap:anywhere; }
.conversation-row:hover { background:var(--sidebar); }
.conversation-row span, .conversation-row small { color:var(--muted); }
</style>
