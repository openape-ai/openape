<script setup lang="ts">
import type { MessagesAccessCommand, MessagesView, WorkspaceAccess, WorkspaceSnapshot } from '../workspace-access'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { diagnostic } from '../i18n'
import type { CentralCommand } from '../../contracts/central'
import type { ApprovalHistoryCommand, ApprovalHistoryView } from '../../contracts/approval-history'
import type { MapView } from '../../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import AutomationsShell from './AutomationsShell.vue'

const props = defineProps<{ access: WorkspaceAccess, sharing?: boolean, paused?: boolean, revision?: number }>()
const emit = defineEmits<{ openPod: [id: string], settings: [] }>()
const map = ref<MapView | null>(null)
const approvalHistory = ref<ApprovalHistoryView | null>(null)
const codex = ref<WorkspaceSnapshot['codex']>()
const live = ref(false)
const secrets = ref<SecretsView | null>(null)
const messages = ref<MessagesView | null>(null)
const tab = ref<'automations' | 'decisions' | 'messages'>('automations')
const now = ref(Date.now())
const error = ref('')
const actionError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false
let polling = false
async function poll() {
  if (props.paused || polling || closed) return
  polling = true; clearTimeout(timer)
  try {
    const snapshot = await props.access.read()
    if (closed) return
    map.value = snapshot.map; approvalHistory.value = snapshot.approvalHistory; codex.value = snapshot.codex
    secrets.value = snapshot.secrets; messages.value = snapshot.messages ?? null; live.value = snapshot.live; now.value = Date.now(); error.value = ''
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { polling = false }
  if (!closed && !props.paused) timer = setTimeout(() => { void poll() }, 1000)
}
onMounted(poll)
watch(() => props.revision, () => { void poll() })
watch(() => props.paused, (paused) => { if (paused) clearTimeout(timer); else void poll() })
onBeforeUnmount(() => { closed = true; clearTimeout(timer) })
async function run(action: () => Promise<unknown>, settle?: (error: string | null) => void) {
  try { await action(); if (closed) return; actionError.value = ''; settle?.(null); await poll() }
  catch (cause) { actionError.value = cause instanceof Error ? cause.message : String(cause); settle?.(actionError.value) }
}
const localCommand = (command: CentralCommand) => void run(() => props.access.command(command))
function approvalHistoryCommand(command: ApprovalHistoryCommand, settle?: (error: string | null) => void) {
  return void run(async () => {
    if (!props.access.approvalHistory) throw new Error('Domain actions are unavailable on this host')
    await props.access.approvalHistory(command)
  }, settle)
}
function messagesCommand(command: MessagesAccessCommand) {
  return void run(async () => {
    if (!props.access.messages) throw new Error('Messages are unavailable on this host')
    await props.access.messages(command)
  })
}
function secretsCommand(command: SecretsCommand) {
  return void run(async () => {
    if (!props.access.secrets) throw new Error('Secret actions are unavailable on this host')
    await props.access.secrets(command)
  })
}
</script>

<template>
  <p v-if="error" role="alert" class="error-message">
    {{ diagnostic(error) }}
  </p>
  <p v-if="actionError" role="alert" class="error-message" data-action-error>
    {{ diagnostic(actionError) }}
  </p>
  <AutomationsShell :view="map" :live="live" :now="now" :desktop="access.desktop" :inbox-url="access.inboxUrl" :sharing="sharing" :codex="codex" :tab="tab" :approval-history="approvalHistory" :secrets="secrets" :messages="messages" @update:tab="tab = $event" @approval-history="approvalHistoryCommand" @command="localCommand" @secrets="secretsCommand" @messages="messagesCommand" @open-pod="emit('openPod', $event)" @settings="emit('settings')" />
</template>
