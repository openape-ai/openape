<script setup lang="ts">
import type { WorkspaceAccess, WorkspaceSnapshot } from '../workspace-access'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { diagnostic } from '../i18n'
import type { CentralCommand } from '../../contracts/central'
import type { DomainCommand, DomainOverview } from '../../contracts/domain-admin'
import type { MapView } from '../../contracts/map-view'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import AutomationsShell from './AutomationsShell.vue'

const props = defineProps<{ access: WorkspaceAccess, sharing?: boolean, paused?: boolean, revision?: number }>()
const emit = defineEmits<{ openPod: [id: string], settings: [] }>()
const map = ref<MapView | null>(null)
const domain = ref<DomainOverview | null>(null)
const codex = ref<WorkspaceSnapshot['codex']>()
const live = ref(false)
const secrets = ref<SecretsView | null>(null)
const tab = ref<'automations' | 'decisions'>('automations')
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
    map.value = snapshot.map; domain.value = snapshot.domain; codex.value = snapshot.codex
    secrets.value = snapshot.secrets; live.value = snapshot.live; now.value = Date.now(); error.value = ''
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
function domainCommand(command: DomainCommand, settle?: (error: string | null) => void) {
  return void run(async () => {
    if (!props.access.domain) throw new Error('Domain actions are unavailable on this host')
    await props.access.domain(command)
  }, settle)
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
  <AutomationsShell :view="map" :live="live" :now="now" :desktop="access.desktop" :inbox-url="access.inboxUrl" :sharing="sharing" :codex="codex" :tab="tab" :domain="domain" :secrets="secrets" @update:tab="tab = $event" @domain="domainCommand" @command="localCommand" @secrets="secretsCommand" @open-pod="emit('openPod', $event)" @settings="emit('settings')" />
</template>
