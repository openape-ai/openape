<script setup lang="ts">
import { t, diagnostic, label } from '../i18n'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { CentralClient, CentralCommand, CentralRunDetail, CentralRuntime, CentralStatus, CentralSummary } from '../../contracts/central'
import type { RunRecord } from '../../contracts/runs'
import { parseScriptView } from '../../contracts/scripts'
import type { ScriptSource } from '../../contracts/scripts'
import { WorkspaceRequestError } from './client'
import { connected, connectionAfter, connectionLevel, sidebar } from './status'

const props = defineProps<{ client: CentralClient, desktop?: boolean, desktopStatus?: CentralStatus | null }>()
const emit = defineEmits<{ settings: [], login: [], logout: [] }>()
const runtimes = ref<CentralRuntime[]>([])
const selected = ref<{ runtimeId: string, podId: string } | null>(null)
const current = shallowRef<CentralSummary | null>(null)
const baseline = shallowRef<CentralSummary['pod'] | null>(null)
const olderRuns = shallowRef<RunRecord[]>([])
const runDetail = shallowRef<CentralRunDetail | null>(null)
const error = ref('')
const connection = shallowRef(connected)
const connectionError = computed(() => connection.value.error)
const notice = ref('')
const busy = ref(false)
const authenticated = ref(true)
const tab = ref('Overview')
const tabs = ['Overview', 'Script', 'Values', 'Permissions', 'Settings', 'History']
const name = ref('')
const description = ref('')
const code = ref('')
const source = shallowRef<ScriptSource | null>(null)
const variableName = ref('')
const variableValue = ref('')
const interval = ref(900)
const dailyTime = ref('09:00')
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone)
const scheduleKind = ref('interval')
const scheduleEnabled = ref(false)
const newName = ref('')
const newGroup = ref('')
const runId = ref('')
const groupId = ref('')
const operationId = ref('')
const abort = new AbortController()
let refreshing: Promise<void> | null = null
let generation = 0
let savedEditor = ''
const runtime = computed(() => runtimes.value.find(item => item.id === selected.value?.runtimeId))
const listed = computed(() => runtime.value?.workspace.pods.find(item => item.id === selected.value?.podId))
const available = computed(() => !!listed.value?.online && !!current.value)
const runList = computed(() => [...current.value?.pod.runs.runs ?? [], ...olderRuns.value])
const activeRuntime = computed(() => runtime.value?.online ? runtime.value : runtimes.value.find(item => item.online))

function editorState() {
  return JSON.stringify([name.value, description.value, source.value?.id, code.value, variableName.value, variableValue.value, scheduleKind.value, interval.value, dailyTime.value, timezone.value, scheduleEnabled.value, groupId.value])
}
function resetEditor() {
  const pod = current.value?.pod
  if (!pod) return
  baseline.value = structuredClone(pod)
  name.value = pod.scripts.pod.name
  description.value = pod.details.description?.text ?? ''
  selectSource(pod.scripts.source)
  scheduleKind.value = pod.scheduling.spec?.kind ?? 'interval'
  if (pod.scheduling.spec?.kind === 'interval') interval.value = pod.scheduling.spec.seconds
  if (pod.scheduling.spec?.kind === 'daily') { dailyTime.value = pod.scheduling.spec.time; timezone.value = pod.scheduling.spec.timezone }
  scheduleEnabled.value = pod.scheduling.enabled
  groupId.value = runtime.value?.workspace.organization.groups.find(group => group.podIds.includes(pod.id))?.id ?? ''
  savedEditor = editorState()
}
function selectSource(value: ScriptSource | null) { source.value = value ? structuredClone(value) : null; code.value = value?.code ?? '' }
async function refresh() {
  if (refreshing) return refreshing
  const token = generation
  refreshing = (async () => {
    try {
      const inventory = await props.client.inventory()
      if (abort.signal.aborted) return
      runtimes.value = inventory; authenticated.value = true; connection.value = connected
      const target = selected.value
      if (!target || token !== generation) return
      const entry = inventory.find(item => item.id === target.runtimeId)?.workspace.pods.find(item => item.id === target.podId)
      if (!entry?.online) { current.value = null; return }
      const detail = await props.client.read(target.runtimeId, target.podId)
      if (token !== generation || abort.signal.aborted) return
      const unchanged = !baseline.value || editorState() === savedEditor
      current.value = detail
      if (unchanged && !busy.value && !operationId.value) resetEditor()
      if (tab.value === 'History') await loadRun()
    }
    catch (cause) {
      // Keep the last known inventory and content; the service's online flags stay authoritative.
      if (cause instanceof WorkspaceRequestError && cause.status === 401) { authenticated.value = false; current.value = null; baseline.value = null; code.value = ''; description.value = ''; runtimes.value = [] }
      connection.value = connectionAfter(connection.value, cause instanceof Error ? cause.message : 'Workspace is unavailable', Date.now())
    }
  })().finally(() => { refreshing = null })
  return refreshing
}
async function select(runtimeId: string, podId: string) {
  if (busy.value) return
  generation++; selected.value = { runtimeId, podId }; current.value = null; baseline.value = null; source.value = null; olderRuns.value = []; runDetail.value = null
  code.value = ''; description.value = ''; runId.value = ''; error.value = ''; notice.value = ''
  await refreshing; await refresh()
}
async function send(channel: CentralCommand['channel'], body: Record<string, unknown>, target = runtime.value) {
  if (!target?.online || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  const id = crypto.randomUUID(); operationId.value = id
  let accepted = false
  try {
    let operation = await props.client.command(target.id, current.value?.revision ?? target.revision, { channel, body }, id)
    accepted = true
    while (['accepted', 'started'].includes(operation.state) && !abort.signal.aborted) {
      await wait(500)
      operation = await props.client.operation(id)
    }
    if (operation.state !== 'applied') throw new Error(operation.error ?? 'The command could not be confirmed. Inspect its outcome before retrying.')
    operationId.value = ''; notice.value = 'Saved to your workspace.'
    await refresh(); resetEditor()
    if (channel === 'scripts') selectSource(parseScriptView(operation.result).source)
  }
  catch (cause) {
    error.value = `${cause instanceof Error ? cause.message : 'Workspace command failed'}${accepted ? ` · Operation ${id}` : ''}`
    if (!accepted && cause instanceof WorkspaceRequestError && cause.status >= 400 && cause.status < 500) operationId.value = ''
    await refresh()
  }
  finally { busy.value = false }
}
async function reconcile() {
  if (!operationId.value || busy.value) return
  busy.value = true
  try {
    const operation = await props.client.operation(operationId.value)
    if (operation.state === 'applied' || operation.state === 'failed') {
      operationId.value = ''; notice.value = operation.state === 'applied' ? 'Saved to your workspace.' : 'The command failed.'
      await refresh(); if (operation.state === 'applied') resetEditor()
    }
    else {
      error.value = `Operation ${operation.id}: ${operation.state}. No command was repeated.`
    }
  }
  catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
function editDescription() {
  if (!baseline.value) return
  return send('details', { type: 'describe', podId: baseline.value.id, revision: baseline.value.details.description?.revision ?? 0, text: description.value })
}
function saveScript() {
  if (!baseline.value) return
  return send('scripts', { type: 'save', podId: baseline.value.id, revision: baseline.value.scripts.pod.revision, draftId: source.value?.kind === 'draft' ? source.value.id : null, draftRevision: source.value?.kind === 'draft' ? source.value.revision : 0, code: code.value, capabilities: source.value?.capabilities ?? [], ...(source.value?.packages ? { packages: source.value.packages } : {}) })
}
function draftAction(type: 'validate' | 'prepareDependencies') {
  if (!baseline.value || source.value?.kind !== 'draft') return
  return send('scripts', { type, podId: baseline.value.id, revision: baseline.value.scripts.pod.revision, draftId: source.value.id, draftRevision: source.value.revision })
}
function activate() {
  if (!baseline.value || !source.value?.hash) return
  return send('scripts', { type: 'activate', podId: baseline.value.id, revision: baseline.value.scripts.pod.revision, hash: source.value.hash, expectedActive: baseline.value.scripts.pod.activeScript })
}
function saveSchedule() {
  if (!baseline.value) return
  return send('scheduling', { type: 'save', podId: baseline.value.id, revision: baseline.value.scheduling.revision, enabled: scheduleEnabled.value, spec: scheduleKind.value === 'interval' ? { kind: 'interval', seconds: interval.value } : { kind: 'daily', time: dailyTime.value, timezone: timezone.value } })
}
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (abort.signal.aborted) { resolve(); return }
    let timer: ReturnType<typeof setTimeout>
    const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve() }
    timer = setTimeout(done, ms); abort.signal.addEventListener('abort', done, { once: true })
  })
}
async function loadRun() {
  const target = selected.value
  const id = runId.value || current.value?.pod.runs.runs[0]?.id
  if (!target || !id) { runDetail.value = null; return }
  const token = generation
  const detail = await props.client.run(target.runtimeId, target.podId, id)
  if (token === generation) runDetail.value = detail
}
async function loadOlderRuns() {
  const target = selected.value
  if (!target || !current.value) return
  const page = await props.client.runs(target.runtimeId, target.podId, runList.value.length)
  olderRuns.value = [...olderRuns.value, ...page.runs]
}
async function selectVersion(selection: string) {
  const target = selected.value
  if (!selection || !target) { selectSource(null); return }
  try { selectSource((await props.client.version(target.runtimeId, target.podId, selection)).version.source) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
watch([tab, runId], () => { if (tab.value === 'History') loadRun().catch((cause: unknown) => { error.value = cause instanceof Error ? cause.message : String(cause) }) })
function time(value: number | null | undefined): string { return value ? new Date(value).toLocaleString() : '' }
// Refreshes only when the service reports a change; errors back off instead of spinning.
async function watchChanges() {
  let cursor = 0
  while (!abort.signal.aborted) {
    try {
      const next = (await props.client.changes(cursor, abort.signal)).cursor
      if (next !== cursor) { cursor = next; await refresh() }
    }
    catch (cause) {
      if (abort.signal.aborted) return
      connection.value = connectionAfter(connection.value, String(cause), Date.now())
      await wait(2000)
      await refresh()
    }
  }
}
onMounted(async () => { await refresh(); await watchChanges() })
onBeforeUnmount(() => { generation++; abort.abort() })
</script>

<template>
  <div class="central-workspace" :class="{ 'central-desktop': desktop }">
    <header class="central-header">
      <div><span class="central-mark">◉</span><strong>{{ t('OpenApe Pods') }}</strong><span class="central-muted">{{ t('Your workspace') }}</span></div><button v-if="desktop" @click="emit('settings')">
        {{ t('Desktop settings') }}
      </button><button v-else-if="authenticated" @click="emit('logout')">
        {{ t('Sign out') }}
      </button>
    </header>
    <div v-if="!authenticated" class="central-empty">
      <h1>{{ t('Your Pods, together') }}</h1><p>{{ t('Sign in to see your Pods and their latest runs.') }}</p><button @click="emit('login')">
        {{ t('Sign in with OpenApe') }}
      </button><p v-if="error" role="alert">
        {{ diagnostic(error) }}
      </p>
    </div>
    <div v-else class="central-layout">
      <aside class="central-sidebar" :aria-label="t('Pods')">
        <h2>{{ t('Pods') }} <span class="central-muted">{{ runtimes.reduce((count, item) => count + item.workspace.pods.length, 0) }}</span></h2>
        <form class="central-create" @submit.prevent="send('workspace', { type: 'create', name: newName }, activeRuntime)">
          <input v-model="newName" :aria-label="t('New Pod name')" :placeholder="t('New Pod')" maxlength="100"><button :disabled="!activeRuntime || !newName.trim() || busy || !!operationId">
            {{ t('Add') }}
          </button>
        </form>
        <section v-for="host in runtimes" :key="host.id">
          <p class="central-runtime" :class="{ 'central-online': host.online }">
            ● {{ host.online ? t('Desktop online') : host.lastSeenAt ? t('Desktop offline since {time}', { time: time(host.lastSeenAt) }) : t('Desktop offline') }}
          </p>
          <template v-for="group in sidebar(host).groups" :key="group.id">
            <h3>{{ group.id ? group.name : t('Ungrouped') }}</h3>
            <button v-for="pod in group.pods" :key="pod.id" class="central-pod" :aria-current="selected?.podId === pod.id ? 'true' : undefined" :disabled="busy || !pod.online" @click="select(host.id, pod.id)">
              <span>{{ pod.name }}</span><small v-if="pod.queue?.blocked" class="central-blocked">● {{ t('Schedule blocked') }}</small><small v-else :class="{ 'central-online': pod.online }">● {{ pod.online ? t('Online') : t('Offline') }}</small>
            </button>
          </template>
          <details v-if="sidebar(host).archived.length" class="central-archived">
            <summary>{{ t('Archived') }} <span class="central-muted">{{ sidebar(host).archived.length }}</span></summary>
            <button v-for="pod in sidebar(host).archived" :key="pod.id" class="central-pod" :aria-current="selected?.podId === pod.id ? 'true' : undefined" :disabled="busy || !pod.online" @click="select(host.id, pod.id)">
              <span>{{ pod.name }}</span><small>{{ t('Archived') }}</small>
            </button>
          </details>
        </section>
        <p v-if="!runtimes.length" class="central-muted">
          {{ t('Connect your desktop to bring your Pods online.') }}
        </p>
      </aside>
      <main class="central-content">
        <p v-if="desktopStatus && desktopStatus.state !== 'online'" role="alert" class="central-error">
          {{ desktopStatus.state === 'connecting' ? t('This desktop is connecting to your workspace.') : desktopStatus.state === 'reconnecting' ? t('This desktop is reconnecting since {time}.', { time: time(desktopStatus.since) }) : t('This desktop is offline since {time}. Scheduled runs are paused until it reconnects.', { time: time(desktopStatus.since) }) }}
          <span v-if="desktopStatus.error">{{ diagnostic(desktopStatus.error) }}</span>
        </p>
        <p v-else-if="desktopStatus?.tickTimeout && Date.now() - desktopStatus.tickTimeout.at < 3600000" role="alert" class="central-error">
          {{ t('The scheduler step "{phase}" did not finish at {time}; scheduling continued. Restart the app if runs stop.', { phase: desktopStatus.tickTimeout.phase, time: time(desktopStatus.tickTimeout.at) }) }}
        </p>
        <p v-if="error" role="alert" class="central-error">
          {{ diagnostic(error) }}
        </p><p v-else-if="connectionError" role="alert" class="central-error">
          {{ connectionLevel(connection) === 'offline' ? t('Workspace unreachable since {time}:', { time: time(connection.since) }) : t('Reconnecting to your workspace…') }} {{ diagnostic(connectionError) }}
        </p><p v-if="notice" role="status">
          {{ diagnostic(notice) }}
        </p>
        <p v-if="operationId && !busy">
          <button @click="reconcile">
            {{ t('Check pending operation') }}
          </button> {{ t('Review its result before making another change.') }}
        </p>
        <div v-if="!available" class="central-empty">
          <h1>{{ listed?.name ?? t('Your Pods') }}</h1><p>{{ listed ? t('This Pod is offline. Its contents will be available when it reconnects.') : t('Choose an online Pod to see its scripts, settings and recent runs.') }}</p><button @click="refresh">
            {{ t('Refresh') }}
          </button>
        </div>
        <template v-else-if="current && baseline">
          <div class="central-title">
            <div><span class="central-eyebrow">{{ t('POD · ONLINE') }}</span><h1>{{ current.pod.scripts.pod.name }}</h1><p>{{ label(current.pod.scripts.pod.lifecycle) }} · {{ current.total }} {{ t('recent runs') }}</p></div><button :disabled="busy" @click="resetEditor">
              {{ t('Reload saved version') }}
            </button>
          </div>
          <nav class="central-tabs" :aria-label="t('Pod sections')">
            <button v-for="item in tabs" :key="item" :aria-current="tab === item ? 'page' : undefined" @click="tab = item">
              {{ label(item) }}
            </button>
          </nav>
          <fieldset :disabled="busy || !!operationId">
            <section v-if="tab === 'Overview'">
              <p v-if="current.pod.scheduling.blocked" role="alert" class="central-error">
                {{ current.pod.scheduling.blockedSince ? t('Schedule blocked since {time}.', { time: time(current.pod.scheduling.blockedSince) }) : t('Schedule blocked.') }} {{ current.pod.scheduling.error }} {{ t('Review the failed run in History before new inputs can run.') }}
              </p>
              <h2>{{ t('What this Pod does') }}</h2><textarea v-model="description" :aria-label="t('Pod description')" rows="5" maxlength="4000" /><button @click="editDescription">
                {{ t('Save description') }}
              </button>
              <div class="central-actions">
                <button :disabled="!current.pod.scripts.pod.activeScript" @click="send('runs', { type: 'start', podId: current.pod.id, expectedScript: current.pod.scripts.pod.activeScript })">
                  {{ t('Run now') }}
                </button><button @click="send('scheduling', { type: 'lifecycle', podId: current.pod.id, revision: current.pod.scripts.pod.revision, lifecycle: current.pod.scripts.pod.lifecycle === 'active' ? 'paused' : 'active' })">
                  {{ current.pod.scripts.pod.lifecycle === 'active' ? t('Pause automatic runs') : t('Resume automatic runs') }}
                </button>
              </div>
              <h2>{{ t('Latest runs') }}</h2><article v-for="run in current.pod.runs.runs.slice(0, 5)" :key="run.id" class="central-card">
                <strong>{{ label(run.state) }}</strong><time>{{ new Date(run.startedAt).toLocaleString() }}</time><p>{{ run.summary || t('Run in progress') }}</p><p v-if="run.error" class="central-error">
                  {{ run.error }}
                </p><button @click="runId = run.id; tab = 'History'">
                  {{ t('View run') }}
                </button>
              </article><p v-if="!current.pod.runs.runs.length">
                {{ t('No runs yet.') }}
              </p>
            </section>
            <section v-if="tab === 'Script'">
              <label>{{ t('Version') }}<select :value="source?.id ?? ''" @change="selectVersion(($event.target as HTMLSelectElement).value)"><option value="">{{ t('New draft') }}</option><option v-for="draft in current.pod.scripts.drafts" :key="draft.id" :value="draft.id">{{ t('Draft') }} {{ draft.id.slice(0, 8) }} · {{ draft.validated ? t('validated') : t('not validated') }}</option><option v-for="version in current.pod.scripts.versions" :key="version.hash" :value="version.hash">{{ version.hash.slice(0, 12) }} {{ version.active ? `· ${label('active')}` : '' }}</option></select></label>
              <textarea v-model="code" class="central-code" :aria-label="t('Script source')" rows="20" spellcheck="false" />
              <div class="central-actions">
                <button @click="saveScript">
                  {{ t('Save draft') }}
                </button><button :disabled="source?.kind !== 'draft' || code !== source.code" @click="draftAction('prepareDependencies')">
                  {{ t('Prepare packages') }}
                </button><button :disabled="source?.kind !== 'draft' || code !== source.code" @click="draftAction('validate')">
                  {{ t('Validate') }}
                </button><button :disabled="!source?.validated || !source.hash || code !== source.code" @click="activate">
                  {{ t('Activate version') }}
                </button>
              </div><pre v-if="source?.evidence">{{ source.evidence }}</pre>
            </section>
            <section v-if="tab === 'Values'">
              <slot name="secrets" :pod-id="current.pod.id" /><h2>{{ t('Variables') }}</h2><p>{{ t('Ordinary values are shared with your Pod. Manage secrets on the desktop.') }}</p><article v-for="variable in current.pod.resources.variables" :key="variable.name" class="central-card">
                <strong>{{ variable.name }}</strong><pre>{{ variable.value }}</pre><button @click="variableName = variable.name; variableValue = variable.value">
                  {{ t('Edit') }}
                </button><button @click="send('resources', { type: 'removeVariable', podId: current.pod.id, name: variable.name, revision: variable.revision })">
                  {{ t('Remove') }}
                </button>
              </article>
              <label>{{ t('Name') }}<input v-model="variableName" maxlength="64"></label><label>{{ t('Value') }}<textarea v-model="variableValue" maxlength="2048" /></label><button :disabled="!variableName" @click="send('resources', { type: 'saveVariable', podId: current.pod.id, name: variableName, value: variableValue, revision: baseline.resources.variables?.find(item => item.name === variableName)?.revision ?? 0 })">
                {{ t('Save variable') }}
              </button>
            </section>
            <section v-if="tab === 'Permissions'">
              <slot name="permissions" :pod-id="current.pod.id" /><h2>{{ t('Assigned access') }}</h2><p>{{ t('Assign programs, credentials and local folders on the desktop.') }}</p><article v-for="resource in current.pod.resources.resources" :key="resource.id" class="central-card">
                <strong>{{ resource.name }}</strong><p>{{ label(resource.kind) }} · {{ label(resource.state) }}</p><button :disabled="resource.state === 'revoked'" @click="send('resources', { type: 'revoke', podId: current.pod.id, id: resource.id, revision: resource.revision })">
                  {{ t('Revoke access') }}
                </button>
              </article>
            </section>
            <section v-if="tab === 'Settings'">
              <h2>{{ t('Pod settings') }}</h2><label>{{ t('Name') }}<input v-model="name" maxlength="100"></label><button @click="send('workspace', { type: 'update', id: current.pod.id, revision: baseline.scripts.pod.revision, name, lifecycle: baseline.scripts.pod.lifecycle })">
                {{ t('Save name') }}
              </button>
              <h2>{{ t('Group') }}</h2><label>{{ t('Group') }}<select v-model="groupId"><option value="">{{ t('Ungrouped') }}</option><option v-for="group in runtime?.workspace.organization.groups" :key="group.id" :value="group.id">{{ group.id ? group.name : t('Ungrouped') }}</option></select></label><button @click="send('workspace', { type: 'organize', action: 'move', revision: runtime?.workspace.organization.revision, podId: current.pod.id, groupId: groupId || null })">
                {{ t('Move Pod') }}
              </button><label>{{ t('New group') }}<input v-model="newGroup" maxlength="100"></label><button :disabled="!newGroup.trim()" @click="send('workspace', { type: 'organize', action: 'create', revision: runtime?.workspace.organization.revision, name: newGroup })">
                {{ t('Create group') }}
              </button>
              <h2>{{ t('Schedule') }}</h2><label>{{ t('Frequency') }}<select v-model="scheduleKind"><option value="interval">{{ t('Interval') }}</option><option value="daily">{{ t('Daily') }}</option></select></label><label v-if="scheduleKind === 'interval'">{{ t('Every (seconds)') }}<input v-model.number="interval" type="number" min="60" max="2592000"></label><template v-else>
                <label>{{ t('Time') }}<input v-model="dailyTime" type="time"></label><label>{{ t('Timezone') }}<input v-model="timezone"></label>
              </template><label class="central-check"><input v-model="scheduleEnabled" type="checkbox"> {{ t('Schedule enabled') }}</label><button @click="saveSchedule">
                {{ t('Save schedule') }}
              </button><p>{{ t('Next run:') }} {{ current.pod.scheduling.nextAt ? new Date(current.pod.scheduling.nextAt).toLocaleString() : t('Not scheduled') }}</p><p v-if="current.pod.scheduling.error" role="alert">
                {{ current.pod.scheduling.error }}
              </p>
            </section>
            <section v-if="tab === 'History'">
              <h2>{{ t('Run history') }}</h2><label>{{ t('Run') }}<select v-model="runId"><option value="">{{ t('Recent events') }}</option><option v-for="run in runList" :key="run.id" :value="run.id">{{ new Date(run.startedAt).toLocaleString() }} · {{ label(run.state) }}</option></select></label><button v-if="runList.length < current.total" @click="loadOlderRuns">
                {{ t('Load older runs') }}
              </button><article v-for="run in runDetail ? [runDetail.run] : []" :key="run.id" class="central-card">
                <strong>{{ label(run.state) }}</strong><p>{{ run.summary }}</p><p v-if="run.error" class="central-error">
                  {{ run.error }}
                </p><button v-if="run.state === 'running'" @click="send('runs', { type: 'cancel', podId: current.pod.id, runId: run.id })">
                  {{ t('Cancel run') }}
                </button><p v-if="run.recovery">
                  {{ t('Recovery:') }} {{ label(run.recovery.state) }} {{ run.recovery.error }}
                </p>
              </article><pre v-for="event in runDetail?.events" :key="event.sequence">{{ event.type }} · {{ new Date(event.at).toLocaleTimeString() }}
              {{ JSON.stringify(event.data, null, 2) }}</pre>
            </section>
          </fieldset>
          <p v-if="busy" role="status">
            {{ t('Waiting for the desktop and central storage…') }}
          </p>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.central-desktop .central-header{padding-left:96px;-webkit-app-region:drag}.central-desktop .central-header button{-webkit-app-region:no-drag}
.central-workspace{--line:light-dark(#e2e5ea,#333e45);--muted:light-dark(#68717d,#a2adb5);--accent:light-dark(#226345,#9bd5b1);background:light-dark(#fafbfc,#151b20);color:light-dark(#20272e,#e4e9ed);min-height:100vh;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.central-workspace *{box-sizing:border-box}.central-header{height:72px;background:light-dark(white,#1d252b);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 28px}.central-header>div{display:flex;gap:16px;align-items:center}.central-header strong{font-size:18px}.central-mark{color:var(--accent);font-size:28px}.central-muted{color:var(--muted)}.central-layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:calc(100vh - 72px)}.central-sidebar{border-right:1px solid var(--line);padding:22px 16px;background:light-dark(white,#1d252b)}.central-sidebar h2{font-size:17px;margin:0 8px 16px}.central-sidebar h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:26px 8px 10px}.central-create{display:flex;gap:5px}.central-create input{min-width:0}.central-pod{display:flex!important;justify-content:space-between;gap:8px;width:100%;text-align:left;margin:4px 0;border-color:transparent!important;background:transparent!important}.central-pod span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.central-pod small{white-space:nowrap;font-size:10px;color:var(--muted)}.central-pod[aria-current]{background:light-dark(#edf5f0,#25392e)!important;border-color:light-dark(#cbded2,#486251)!important}.central-online{color:var(--accent)!important}.central-blocked{color:light-dark(#a32c25,#ffb8ac)!important}.central-runtime{font-size:12px;color:var(--muted);margin:14px 8px 0}.central-archived summary{cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:26px 8px 10px}.central-content{max-width:1150px;width:100%;padding:34px 44px 70px;min-width:0}.central-title{display:flex;align-items:center;justify-content:space-between;gap:20px}.central-title h1{font-size:30px;letter-spacing:-.03em;margin:5px 0;overflow-wrap:anywhere}.central-title p{margin:0;color:var(--muted)}.central-eyebrow{font-size:10px;letter-spacing:.13em;color:var(--accent);font-weight:650}.central-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin:28px 0;overflow-x:auto}.central-tabs button{background:none;border:0;border-radius:0;padding:12px 10px;white-space:nowrap}.central-tabs button[aria-current]{border-bottom:2px solid var(--accent);color:var(--accent);font-weight:650}.central-workspace button{font:inherit;background:light-dark(white,#1d252b);border:1px solid light-dark(#ccd3d8,#44505a);border-radius:6px;padding:8px 12px;color:inherit;cursor:pointer}.central-workspace button:hover:not(:disabled){background:light-dark(#f0f5f2,#2a3b30)}.central-workspace button:disabled{cursor:default;opacity:.5}.central-workspace input,.central-workspace textarea,.central-workspace select{font:inherit;display:block;width:100%;padding:9px 11px;border:1px solid light-dark(#cdd4da,#44505a);border-radius:6px;background:light-dark(white,#1d252b);color:inherit}.central-workspace textarea{resize:vertical;margin:8px 0 12px}.central-workspace label{display:block;max-width:580px;margin:14px 0}.central-workspace h2{font-size:18px;margin:26px 0 12px}.central-workspace fieldset{border:0;padding:0;margin:0;min-width:0}.central-check{display:flex!important;align-items:center;gap:10px}.central-check input{width:auto}.central-card{background:light-dark(white,#1d252b);border:1px solid var(--line);border-radius:9px;padding:17px 20px;margin:12px 0}.central-card time{float:right;color:var(--muted);font-size:12px}.central-card p{margin:8px 0 12px}.central-actions{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0}.central-code{font:12px/1.65 ui-monospace,SFMono-Regular,monospace!important;tab-size:2}.central-workspace pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,monospace;background:light-dark(#f0f3f5,#212c33);border-radius:6px;padding:14px;max-height:420px;overflow:auto}.central-error{color:light-dark(#a32c25,#ffb8ac);overflow-wrap:anywhere;background:light-dark(#fff0ed,#462922);padding:12px;border-radius:6px}.central-empty{padding:70px 20px;max-width:650px;margin:auto}.central-empty h1{font-size:30px}.central-empty p{color:var(--muted)}@media(max-width:760px){.central-header{padding:0 16px}.central-header .central-muted{display:none}.central-layout{grid-template-columns:1fr}.central-sidebar{border-right:0;border-bottom:1px solid var(--line);max-height:300px;overflow:auto}.central-content{padding:24px 18px}.central-title{align-items:flex-start}.central-title h1{font-size:25px}.central-title>button{max-width:125px}.central-card time{float:none;display:block}}
</style>
