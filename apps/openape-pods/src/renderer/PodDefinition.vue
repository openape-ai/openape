<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { DefinitionsView, DefinitionCommand, DefinitionUpdateView } from '../contracts/definitions'
import type { Organization } from '../contracts/groups'
import { t, diagnostic } from './i18n'

const props = defineProps<{ pod: StoredPod }>()
const emit = defineEmits<{ changed: [] }>()
const view = ref<DefinitionsView>({ definitions: [], instances: [], provisioning: [] })
const podNames = ref<Record<string, string>>({})
const organization = ref<Organization>({ revision: 1, groups: [] })
const busy = ref(false); const error = ref(''); const message = ref('')
const definitionName = ref(props.pod.name); const defaults = ref('{}')
const instanceName = ref(props.pod.name); const groupId = ref(''); const version = ref(0)
const update = ref<DefinitionUpdateView | null>(null); const validated = ref(false)
const requestId = ref(crypto.randomUUID())
let initialized = false
const binding = computed(() => view.value.instances.find(item => item.podId === props.pod.id))
const definition = computed(() => view.value.definitions.find(item => item.id === binding.value?.definitionId))
const versions = computed(() => definition.value?.versions.filter(item => item.state === 'published') ?? [])
const selected = computed(() => versions.value.find(item => item.version === version.value))
const pendingCreation = computed(() => view.value.provisioning.find(item => item.requestId === requestId.value && item.state !== 'ready'))
const pending = computed(() => view.value.provisioning.filter(item => item.state !== 'ready' && view.value.instances.some(instance => instance.podId === item.podId && instance.definitionId === definition.value?.id)))
const differences = computed(() => update.value
  ? [
      { label: t('Code'), before: update.value.beforeCode, after: update.value.afterCode },
      { label: t('Contract'), before: update.value.before.contract, after: update.value.after.contract },
      { label: t('Dependencies'), before: { lock: update.value.before.lockHash, packages: update.value.before.packages }, after: { lock: update.value.after.lockHash, packages: update.value.after.packages } },
      { label: t('Public defaults'), before: update.value.before.defaults, after: update.value.after.defaults },
      { label: t('Requested rights'), before: update.value.before.capabilities, after: update.value.after.capabilities },
    ]
  : [])
const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await action() }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Definition operation failed' }
  finally { busy.value = false }
}
async function load() {
  view.value = await window.pods.definitions({ type: 'list' })
  const workspace = await window.pods.workspace({ type: 'list' })
  organization.value = workspace.organization
  podNames.value = Object.fromEntries(workspace.pods.map(pod => [pod.id, pod.name]))
  if (!initialized) {
    definitionName.value = definition.value?.name ?? props.pod.name
    defaults.value = JSON.stringify(definition.value?.versions.find(item => item.version === binding.value?.version)?.defaults ?? versions.value.at(-1)?.defaults ?? {}, null, 2)
    initialized = true
  }
  if (!versions.value.some(item => item.version === version.value)) version.value = versions.value.at(-1)?.version ?? 0
}
async function toggle(event: Event) { if ((event.target as HTMLDetailsElement).open) await perform(load) }
async function command(command: DefinitionCommand) {
  try { view.value = await window.pods.definitions(command); emit('changed') }
  catch (failure) {
    try { view.value = await window.pods.definitions({ type: 'list' }); emit('changed') }
    catch (refreshFailure) { throw new Error(`${String(failure)}; state refresh failed: ${String(refreshFailure)}`) }
    throw failure
  }
}
async function publish(local = false) {
  await perform(async () => {
    const scripts = await window.pods.scripts({ type: 'list', podId: props.pod.id })
    if (!scripts.pod.activeScript) throw new Error('Activate a validated script before publishing its definition')
    let values: Record<string, unknown>
    try { values = JSON.parse(defaults.value) }
    catch { throw new Error('Public defaults must be a valid JSON object') }
    await command({ type: local ? 'prepareLocal' : 'publish', podId: props.pod.id, expectedScript: scripts.pod.activeScript, name: definitionName.value, defaults: values })
    version.value = versions.value.at(-1)?.version ?? 0
    message.value = local ? 'Existing instance prepared with its own identity and permissions. Reuse is not enabled.' : 'Definition published. Existing instances keep their selected version.'
  })
}
async function create() {
  await perform(async () => {
    if (!definition.value || !selected.value) return
    await command({ type: 'instantiate', requestId: requestId.value, definitionId: definition.value.id, version: selected.value.version, name: instanceName.value, groupId: groupId.value })
    requestId.value = crypto.randomUUID()
    message.value = 'Instance created paused. Review its permissions and validate its script before activation.'
  })
}
async function retry(id: string) {
  await perform(async () => { await command({ type: 'retryProvision', requestId: id }); if (requestId.value === id) requestId.value = crypto.randomUUID(); message.value = 'Existing instance identity is ready.' })
}
async function preview() {
  await perform(async () => {
    if (!binding.value || !selected.value) return
    const result = await window.pods.definitions({ type: 'previewUpdate', podId: props.pod.id, definitionId: binding.value.definitionId, version: selected.value.version, expectedBinding: binding.value.bindingRevision })
    update.value = result.update!; validated.value = false
  })
}
async function prepare() {
  await perform(async () => {
    if (!binding.value || !update.value || update.value.after.version !== version.value) return
    const result = await window.pods.definitions({ type: 'prepareUpdate', podId: props.pod.id, definitionId: binding.value.definitionId, version: update.value.after.version, expectedBinding: binding.value.bindingRevision })
    update.value = result.update!
    const script = await window.pods.scripts({ type: 'list', podId: props.pod.id, selection: { kind: 'draft', id: update.value.draftId! } })
    const checked = await window.pods.scripts({ type: 'validate', podId: props.pod.id, revision: script.pod.revision, draftId: script.source!.id, draftRevision: script.source!.revision })
    validated.value = checked.source?.validated === true
  })
}
async function activate() {
  await perform(async () => {
    if (!binding.value || !update.value?.draftId || !validated.value || update.value.after.version !== version.value) return
    await command({ type: 'activateUpdate', podId: props.pod.id, draftId: update.value.draftId, expectedBinding: binding.value.bindingRevision })
    update.value = null; validated.value = false
    message.value = 'Version selected. This instance and its network remain paused until explicitly resumed.'
  })
}
</script>

<template>
  <details class="definition-panel" @toggle="toggle">
    <summary>{{ t('Reusable definition') }}</summary>
    <p>{{ t('Reuse code and public defaults. Every instance keeps its own identity, home, state and permissions.') }}</p>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
    <p v-if="message" role="status">
      {{ diagnostic(message) }}
    </p>
    <p v-if="binding">
      {{ t('Selected version {version}', { version: binding.version }) }} <strong v-if="binding.diverged">· {{ t('Active script differs from selected definition') }}</strong>
    </p>
    <p v-if="view.unavailableReason" role="status">
      {{ diagnostic(view.unavailableReason) }}
    </p>
    <fieldset v-if="!view.unavailableReason" :disabled="busy || pod.lifecycle === 'archived'">
      <legend>{{ t('Publish current script') }}</legend>
      <label>{{ t('Definition name') }}<input v-model="definitionName" maxlength="100"></label>
      <label>{{ t('Public defaults') }}<textarea v-model="defaults" rows="3" spellcheck="false" /></label>
      <p class="muted">
        {{ t('Enter public JSON values only. Secrets and existing permission grants are never copied.') }}
      </p>
      <button :disabled="pod.lifecycle !== 'paused'" @click="publish(true)">
        {{ t('Prepare this existing instance') }}
      </button>
      <button @click="publish(false)">
        {{ t('Publish definition') }}
      </button>
    </fieldset>
    <fieldset v-if="versions.length && !view.unavailableReason" :disabled="busy || pod.lifecycle === 'archived'">
      <legend>{{ t('Use a published version') }}</legend>
      <label>{{ t('Version') }}<select v-model="version" @change="update = null; validated = false"><option v-for="item in versions" :key="item.version" :value="item.version">{{ item.version }}</option></select></label>
      <p>{{ t('Requested rights') }}: {{ selected?.capabilities.join(', ') || t('None') }}</p>
      <button @click="preview">
        {{ t('Review update for this instance') }}
      </button>
      <label>{{ t('Instance name') }}<input v-model="instanceName" :disabled="!!pendingCreation" maxlength="100"></label>
      <label>{{ t('Company') }}<select v-model="groupId" :disabled="!!pendingCreation"><option value="">{{ t('Select company') }}</option><option v-for="group in organization.groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
      <button :disabled="!!pendingCreation || !groupId || !instanceName.trim()" @click="create">
        {{ t('Create separate instance') }}
      </button>
    </fieldset>
    <section v-if="update" :aria-label="t('Definition update review')">
      <h3>{{ t('Definition update review') }}</h3>
      <p>{{ t('Review all changes before validating this instance. Open decisions and uncertain effects must be resolved before a network update.') }}</p>
      <div v-for="difference in differences" :key="difference.label" class="definition-difference">
        <h4>{{ difference.label }}</h4>
        <div><strong>{{ t('Before') }}</strong><pre>{{ display(difference.before) }}</pre></div>
        <div><strong>{{ t('After') }}</strong><pre>{{ display(difference.after) }}</pre></div>
      </div>
      <button :disabled="busy || validated" @click="prepare">
        {{ t('Prepare and validate version') }}
      </button>
      <button :disabled="busy || !validated" @click="activate">
        {{ t('Use version for this instance') }}
      </button>
    </section>
    <section v-if="pending.length && !view.unavailableReason" :aria-label="t('Instances awaiting identity')">
      <h3>{{ t('Instances awaiting identity') }}</h3>
      <div v-for="item in pending" :key="item.requestId" class="definition-pending">
        <strong>{{ podNames[item.podId] ?? instanceName }}</strong><code>{{ item.podId }}</code><p v-if="item.error">
          {{ diagnostic(item.error) }}
        </p><button :disabled="busy" @click="retry(item.requestId)">
          {{ t('Retry existing instance') }}
        </button>
      </div>
    </section>
    <button :disabled="busy" @click="perform(load)">
      {{ t('Refresh definitions') }}
    </button>
  </details>
</template>

<style scoped>
.definition-panel { margin-top:20px; overflow-wrap:anywhere; }
summary { cursor:pointer; }
fieldset { min-width:0; margin:16px 0; padding:14px; border:1px solid var(--border); border-radius:8px; }
label { display:grid; gap:6px; margin:12px 0; }
input, select, textarea { box-sizing:border-box; width:100%; min-width:0; padding:9px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; font:inherit; }
.definition-difference { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.definition-difference h4 { grid-column:1 / -1; margin-bottom:0; }
.definition-difference > div { min-width:0; }
pre { max-height:280px; overflow:auto; overflow-wrap:anywhere; white-space:pre-wrap; font:12px/1.6 ui-monospace,monospace; }
button { margin:6px 8px 6px 0; }
.definition-pending { margin:12px 0; }
@media (max-width:640px) { .definition-difference { grid-template-columns:1fr; } }
</style>
