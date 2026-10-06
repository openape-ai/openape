<script setup lang="ts">
import type { PortableInput } from '@openape/pods-protocol'
import { computed, onMounted, ref, watch } from 'vue'
import type { Organization } from '../contracts/groups'
import type { ResourceState } from '../contracts/resources'
import type { PortableImportRequirement, PortableImportValues, PortableImportView, PortableValue, SharingCommand, SharingState } from '../contracts/sharing'
import { diagnostic, t } from './i18n'

// desktop: the package file can be opened and resources bound here; a browser reviews and configures while the desktop transfers files.
const props = defineProps<{ api: (command: SharingCommand) => Promise<SharingState>, organization: Organization, desktop: boolean, resources?: (podId: string) => Promise<ResourceState> }>()
const emit = defineEmits<{ changed: [], openPod: [podId: string] }>()
const imports = ref<PortableImportView[]>([])
const selectedId = ref(''); const busy = ref(false); const error = ref(''); const notice = ref(''); const confirmingAbandon = ref(false)
const values = ref<PortableImportValues>({ pods: {}, compositions: {} })
const groups = ref<Record<string, string>>({})
const bindings = ref<Record<string, string>>({})
const podResources = ref<Record<string, ResourceState>>({})
const current = computed(() => imports.value.find(item => item.id === selectedId.value) ?? null)
const scopes = computed(() => current.value ? [...current.value.manifest.pods.map(pod => ({ scope: 'pods' as const, key: pod.key, title: pod.title, inputs: pod.inputs, bindings: pod.bindings })), ...current.value.manifest.compositions.map(item => ({ scope: 'compositions' as const, key: item.key, title: item.title, inputs: item.inputs, bindings: [] as { input: string }[] }))] : [])
type Scope = typeof scopes.value[number]
const scalar = (input: PortableInput) => ['string', 'number', 'boolean', 'enum'].includes(input.kind)
const requirements = (key: string, scope: 'pod' | 'composition' = 'pod') => current.value?.unresolved.filter(item => item.scope === scope && item.key === key) ?? []
const requirementLabel = (item: PortableImportRequirement) => item.requirement === 'value' ? t('Value {name}', { name: item.name ?? '' }) : item.requirement === 'secret' ? t('Secret {name}', { name: item.name ?? '' }) : item.requirement === 'access' ? t('Access {name}', { name: item.name ?? '' }) : item.requirement === 'application' ? t('Application {name}', { name: item.name ?? '' }) : item.requirement === 'dependencies' ? t('Dependencies') : t('Composition')
const stateLabel = (item: PortableImportView) => item.state === 'staged' ? t('Reviewing') : item.state === 'committed' ? t('Setting up') : item.state === 'completed' ? (item.unresolved.length ? t('Finishing compositions') : t('Completed')) : t('Cancelled')
const deferredOpen = computed(() => current.value?.state === 'completed' && current.value.unresolved.length > 0)
const deferred = (key: string) => current.value?.deferred.includes(key) ?? false
// Setup is complete when only the creation of deferred compositions is left; the worker applies the same rule.
const completable = computed(() => current.value?.state === 'committed' && current.value.unresolved.every(item => item.scope === 'composition' && item.requirement === 'composition' && deferred(item.key)))
function compositionGroupRequired(key: string) {
  const composition = current.value?.manifest.compositions.find(item => item.key === key)
  return !!composition && (composition.kind !== 'sequence' || (current.value?.manifest.compositions.some(item => item.calls.includes(key)) ?? false))
}
// Variable inputs live on the Pod once the copy exists; other inputs stay editable during setup.
const variableBound = (scope: Scope, input: PortableInput) => scope.scope === 'pods' && scope.bindings.some(binding => binding.input === input.key)
const editable = (scope: Scope, input: PortableInput) => scalar(input) && (current.value?.state === 'staged' || (current.value?.state === 'committed' && !variableBound(scope, input)))
const podId = (key: string) => current.value?.pods.find(pod => pod.key === key)?.podId
function entered(scope: 'pods' | 'compositions', key: string, input: PortableInput): PortableValue | '' {
  const pending = values.value[scope][key]
  // A cleared value (null) counts as entered and must not fall back to the saved one.
  const value = pending && input.key in pending ? pending[input.key] : current.value?.values[scope][key]?.[input.key]
  return value ?? input.default ?? ''
}
function enter(scope: 'pods' | 'compositions', key: string, input: PortableInput, raw: string | boolean): void {
  const target = values.value[scope][key] ??= {}
  if (raw === '') { target[input.key] = null; return }
  target[input.key] = input.kind === 'number' ? Number(raw) : input.kind === 'boolean' ? raw === true || raw === 'true' : String(raw)
}
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() }
  catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Sharing operation failed'
    // The journal may have moved on (for example a created copy whose provisioning failed): show the actual state.
    try { apply(await props.api({ scope: 'import', type: 'list' }), true) }
    catch { /* the error above stays visible */ }
  }
  finally { busy.value = false }
}
function apply(state: SharingState, keepForm = false): void {
  imports.value = state.imports
  const done = state.current && (state.current.state === 'cancelled' || (state.current.state === 'completed' && !state.current.unresolved.length))
  if (state.current && !done) {
    selectedId.value = state.current.id
    if (!imports.value.some(item => item.id === state.current!.id)) imports.value = [...imports.value, state.current]
  }
  if (!imports.value.some(item => item.id === selectedId.value)) selectedId.value = imports.value[0]?.id ?? ''
  if (!keepForm) resetForm()
  emit('changed')
}
function resetForm(): void { values.value = { pods: {}, compositions: {} }; bindings.value = {}; groups.value = {}; confirmingAbandon.value = false }
async function run(command: SharingCommand, message = ''): Promise<void> {
  await perform(async () => { apply(await props.api(command)); notice.value = message })
}
async function loadResources(): Promise<void> {
  if (!props.resources || !current.value) return
  for (const pod of current.value.pods) podResources.value = { ...podResources.value, [pod.podId]: await props.resources(pod.podId) }
}
function candidates(key: string, item: PortableImportRequirement) {
  const pod = current.value?.manifest.pods.find(pod => pod.key === key)
  const access = pod?.access.find(access => access.alias === item.name)
  return (podResources.value[podId(key) ?? '']?.resources ?? []).filter(resource => resource.state === 'ready' && (item.requirement === 'application' ? resource.configuration.type === 'program' : access?.kind === 'directory' ? resource.kind === 'directory' : resource.configuration.type === 'http'))
}
// Required boolean inputs count as answered only when saved; an untouched checkbox is saved as false.
function pendingValues(): PortableImportValues {
  const result: PortableImportValues = { pods: { ...values.value.pods }, compositions: { ...values.value.compositions } }
  for (const scope of scopes.value) {
    for (const input of scope.inputs.filter(input => input.kind === 'boolean' && input.required && editable(scope, input))) {
      if (entered(scope.scope, scope.key, input) === '') (result[scope.scope][scope.key] ??= {})[input.key] = false
    }
  }
  return result
}
const dirty = computed(() => Object.values(values.value.pods).some(item => Object.keys(item).length) || Object.values(values.value.compositions).some(item => Object.keys(item).length) || scopes.value.some(scope => scope.inputs.some(input => input.kind === 'boolean' && input.required && editable(scope, input) && entered(scope.scope, scope.key, input) === '')))
const commit = () => run({ scope: 'import', type: 'commit', id: current.value!.id, revision: current.value!.revision }, t('Paused copy created. Assign resources and secrets on each Pod, then finish setup.'))
const complete = () => run({ scope: 'import', type: 'complete', id: current.value!.id, revision: current.value!.revision }, t('Setup finished. Validate and activate each Pod when you are ready.'))
const cancel = () => run({ scope: 'import', type: 'cancel', id: current.value!.id, revision: current.value!.revision }, current.value!.state === 'completed' ? t('Remaining compositions abandoned.') : t('Import cancelled.'))
const save = () => run({ scope: 'import', type: 'configure', id: current.value!.id, revision: current.value!.revision, values: pendingValues() }, t('Values saved.'))
const open = () => run({ scope: 'import', type: 'pickFile' })
const reload = () => run({ scope: 'import', type: 'list' })
const bind = (key: string, item: PortableImportRequirement) => run({ scope: 'import', type: 'bind', id: current.value!.id, revision: current.value!.revision, pod: key, alias: item.name!, resourceId: bindings.value[`${key}/${item.name}`]!, bundle: null }, t('Assignment bound.'))
const prepare = (key: string) => run({ scope: 'import', type: 'prepareDependencies', id: current.value!.id, pod: key }, t('Dependencies prepared.'))
const finalize = (key: string) => run({ scope: 'import', type: 'finalize', id: current.value!.id, revision: current.value!.revision, composition: key, groupId: groups.value[key] || null, reuse: {} }, t('Composition created.'))
// Candidates refresh outside the busy guard so a change applied during an action still loads them.
const refreshCandidates = () => loadResources().catch((failure) => { error.value = failure instanceof Error ? failure.message : 'Sharing operation failed' })
watch(selectedId, () => { resetForm(); void refreshCandidates() })
watch(() => current.value?.revision, () => { void refreshCandidates() })
onMounted(reload)
defineExpose({ reload })
</script>

<template>
  <section class="sharing-import" aria-labelledby="sharing-import-heading">
    <header class="page-heading">
      <h1 id="sharing-import-heading">
        {{ t('Import portable package') }}
      </h1>
      <button v-if="desktop" class="primary" :disabled="busy" @click="open">
        {{ t('Open package…') }}
      </button>
      <p v-else class="muted">
        {{ t('Open the package file on the connected desktop; you can review and configure it here.') }}
      </p>
    </header>
    <p v-if="error" role="alert">
      {{ diagnostic(error) }} <button class="text-button" :disabled="busy" @click="reload">
        {{ t('Reload') }}
      </button>
    </p>
    <p v-else-if="notice" role="status">
      {{ notice }}
    </p>
    <p v-if="!imports.length" class="muted">
      {{ t('No import is in progress. A package creates paused copies with fresh identities; nothing runs until you approve it.') }}
    </p>
    <ul v-else class="sharing-list" :aria-label="t('Imports')">
      <li v-for="item in imports" :key="item.id">
        <button class="text-button" :aria-pressed="item.id === selectedId" @click="selectedId = item.id">
          {{ item.manifest.package.title }} · {{ stateLabel(item) }} · {{ t('{count} open', { count: item.unresolved.length }) }}
        </button>
      </li>
    </ul>
    <article v-if="current" class="sharing-detail" :aria-label="current.manifest.package.title">
      <h2>{{ current.manifest.package.title }} <span class="muted">{{ t('revision {revision}', { revision: current.manifest.package.revision }) }}</span></h2>
      <p v-if="current.manifest.package.description">
        {{ current.manifest.package.description }}
      </p>
      <p class="muted">
        {{ t('Pods: {count}', { count: current.manifest.pods.length }) }} · {{ t('Compositions: {count}', { count: current.manifest.compositions.length }) }} · {{ t('Applications: {count}', { count: current.manifest.applications.length }) }} · {{ stateLabel(current) }}
      </p>
      <fieldset v-for="scope in scopes" :key="`${scope.scope}:${scope.key}`" :disabled="busy || current.state === 'cancelled'">
        <legend>{{ scope.title }}</legend>
        <template v-for="input in scope.inputs.filter(scalar)" :key="input.key">
          <label v-if="editable(scope, input)" :class="{ check: input.kind === 'boolean' }">
            <template v-if="input.kind === 'boolean'">
              <input type="checkbox" :checked="entered(scope.scope, scope.key, input) === true" @change="enter(scope.scope, scope.key, input, ($event.target as HTMLInputElement).checked)">
              {{ input.label }}<span v-if="input.required" aria-hidden="true"> *</span>
            </template>
            <template v-else>
              <span>{{ input.label }}<span v-if="input.required" aria-hidden="true"> *</span></span>
              <select v-if="input.kind === 'enum'" :value="entered(scope.scope, scope.key, input)" @change="enter(scope.scope, scope.key, input, ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('Choose a value') }}</option>
                <option v-for="choice in input.choices" :key="choice" :value="choice">{{ choice }}</option>
              </select>
              <input v-else :type="input.kind === 'number' ? 'number' : 'text'" :value="entered(scope.scope, scope.key, input)" :min="input.minimum" :max="input.maximum" @input="enter(scope.scope, scope.key, input, ($event.target as HTMLInputElement).value)">
            </template>
            <small v-if="input.description" class="muted">{{ input.description }}</small>
          </label>
        </template>
        <template v-if="scope.scope === 'pods' && current.state !== 'staged' && podId(scope.key)">
          <p v-if="!requirements(scope.key).length" class="muted">
            {{ t('Ready: assignments and values are complete.') }}
          </p>
          <ul v-else class="sharing-requirements">
            <li v-for="item in requirements(scope.key)" :key="`${item.requirement}:${item.name}`">
              {{ requirementLabel(item) }}
              <span v-if="item.requirement === 'value' && scope.bindings.some(binding => binding.input === item.name)" class="muted">{{ t('Set this variable on the Pod.') }}</span>
              <span v-else-if="item.requirement === 'secret'" class="muted">{{ t('Add this secret on the Pod.') }}</span>
              <template v-else-if="(item.requirement === 'access' || item.requirement === 'application') && resources">
                <select :value="bindings[`${item.key}/${item.name}`] ?? ''" :aria-label="t('Assignment for {name}', { name: item.name ?? '' })" @change="bindings[`${item.key}/${item.name}`] = ($event.target as HTMLSelectElement).value">
                  <option value="">
                    {{ candidates(scope.key, item).length ? t('Choose an assignment') : t('Assign it on the Pod first') }}
                  </option>
                  <option v-for="resource in candidates(scope.key, item)" :key="resource.id" :value="resource.id">
                    {{ resource.name }}
                  </option>
                </select>
                <button class="secondary" :disabled="!bindings[`${item.key}/${item.name}`]" @click="bind(scope.key, item)">
                  {{ t('Bind') }}
                </button>
              </template>
              <span v-else-if="item.requirement === 'access' || item.requirement === 'application'" class="muted">{{ t('Bind it on the desktop.') }}</span>
              <button v-else-if="item.requirement === 'dependencies' && desktop" class="secondary" @click="prepare(scope.key)">
                {{ t('Prepare dependencies') }}
              </button>
            </li>
          </ul>
          <button class="text-button" @click="emit('openPod', podId(scope.key)!)">
            {{ t('Open Pod') }}
          </button>
        </template>
        <template v-if="scope.scope === 'compositions' && current.state !== 'staged'">
          <p v-if="current.compositions.some(item => item.key === scope.key)" class="muted">
            {{ t('Created and disabled. Enable it after approving its members.') }}
          </p>
          <template v-else-if="requirements(scope.key, 'composition').some(item => item.requirement === 'composition')">
            <p v-if="deferred(scope.key) && current.state !== 'completed'" class="muted">
              {{ t('Created after setup is finished and every member script is approved.') }}
            </p>
            <template v-else>
              <label v-if="compositionGroupRequired(scope.key)">{{ t('Company') }}
                <select v-model="groups[scope.key]"><option value="">{{ t('Select company') }}</option><option v-for="group in organization.groups" :key="group.id" :value="group.id">{{ group.name }}</option></select>
              </label>
              <button class="secondary" :disabled="dirty || (compositionGroupRequired(scope.key) && !groups[scope.key])" :title="dirty ? t('Save values first') : undefined" @click="finalize(scope.key)">
                {{ t('Create composition') }}
              </button>
            </template>
          </template>
        </template>
      </fieldset>
      <div class="sharing-actions">
        <button v-if="dirty && current.state !== 'completed'" class="secondary" :disabled="busy" @click="save">
          {{ t('Save values') }}
        </button>
        <button v-if="current.state === 'staged'" class="primary" :disabled="busy || dirty" :title="dirty ? t('Save values first') : undefined" @click="commit">
          {{ t('Create paused copy') }}
        </button>
        <button v-if="current.state === 'committed'" class="primary" :disabled="busy || !completable || dirty" :title="completable && !dirty ? undefined : t('Resolve every open item first')" @click="complete">
          {{ t('Finish setup') }}
        </button>
        <button v-if="current.state === 'staged'" class="secondary" :disabled="busy" @click="cancel">
          {{ t('Cancel import') }}
        </button>
        <template v-if="deferredOpen">
          <button v-if="!confirmingAbandon" class="secondary" :disabled="busy" @click="confirmingAbandon = true">
            {{ t('Abandon remaining compositions') }}
          </button>
          <template v-else>
            <span role="status">{{ t('Abandoning is final: the remaining compositions can only be created from a fresh import.') }}</span>
            <button class="secondary" :disabled="busy" @click="cancel">
              {{ t('Abandon now') }}
            </button>
            <button class="text-button" @click="confirmingAbandon = false">
              {{ t('Keep them') }}
            </button>
          </template>
        </template>
      </div>
      <p v-if="current.state === 'committed'" class="muted">
        <template v-if="!completable">{{ t('Resolve every open item first') }}. </template>{{ t('Imported Pods stay paused without an active script until you validate and activate them after setup.') }}
      </p>
    </article>
  </section>
</template>
