<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AccessProposal } from '../contracts/master'
import type { SetupRequest } from '../contracts/setup'
import type { PodResource, ResourceState } from '../contracts/resources'
import { parseResourceState } from '../contracts/resources'
import { parseCommandLine } from '../contracts/programs'
import { t, diagnostic } from './i18n'

const props = defineProps<{ proposal: AccessProposal }>()
const emit = defineEmits<{ updated: [] }>()
const open = ref(false); const busy = ref(false); const error = ref(''); const notice = ref('')
const state = ref<ResourceState>({ resources: [], epoch: 0 })
const origin = ref(props.proposal.body.origin ?? '')
const methods = ref([...(props.proposal.body.methods ?? [])])
const path = ref(props.proposal.body.path ?? '')
const referenceKind = ref<'reference' | 'directory'>('reference')
const access = ref(props.proposal.body.access ?? 'read')
const value = ref(''); const revision = ref(0); const applicationId = ref('')
const argumentsLine = ref(props.proposal.body.argv?.map(argument => JSON.stringify(argument)).join(' ') ?? '')
const hosts = ref((props.proposal.body.networkHosts ?? []).join('\n'))
const applications = computed(() => state.value.resources.filter(resource => resource.kind === 'tool' && resource.state === 'ready' && resource.configuration.type === 'program'))
const application = computed(() => applications.value.find(resource => resource.id === applicationId.value))
const request = computed(() => props.proposal.body)

async function review(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    state.value = await window.pods.resources({ type: 'list', podId: props.proposal.podId })
    const variable = state.value.variables?.find(item => item.name === request.value.alias)
    revision.value = variable?.revision ?? 0; value.value = variable?.value ?? ''
    applicationId.value = applications.value.find(item => item.name === request.value.application || item.configuration.cliId === request.value.application)?.id ?? ''
    open.value = true
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Could not load resources' }
  finally { busy.value = false }
}
async function resolve(resource: PodResource | undefined, reviewed: SetupRequest): Promise<void> {
  if (!resource) { notice.value = t('Nothing was granted. You can review this request again.'); return }
  await window.pods.master({ type: 'resolveSetup', id: props.proposal.id, podId: props.proposal.podId, resourceId: resource.id, epoch: state.value.epoch, request: reviewed })
  open.value = false; emit('updated')
}
async function apply(): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  const podId = props.proposal.podId
  try {
    if (request.value.provider === 'variable') {
      await window.pods.master({ type: 'answerSetup', id: props.proposal.id, podId, value: value.value, revision: revision.value })
      open.value = false; emit('updated'); return
    }
    if (request.value.provider === 'http') {
      const permission = { origin: origin.value, methods: [...methods.value] }
      state.value = await window.pods.resources({ type: 'assignHttp', podId, epoch: state.value.epoch, permission })
      await resolve(state.value.resources.find(item => item.state === 'ready' && item.configuration.type === 'http' && item.configuration.origin === new URL(origin.value).origin && methods.value.every(method => (item.configuration.methods as string[]).includes(method))), { ...request.value, ...permission })
      return
    }
    if (request.value.provider === 'reference' && referenceKind.value === 'reference') {
      const before = state.value
      state.value = await window.pods.resources({ type: 'pickReference', podId })
      const reference = state.value.resources.find(item => item.kind === 'reference' && item.state === 'ready' && !before.resources.some(prior => prior.id === item.id && prior.revision === item.revision))
      await resolve(reference, { ...request.value, path: String(reference?.configuration.path ?? '') })
      return
    }
    if (request.value.provider === 'directory' || request.value.provider === 'reference') {
      const before = state.value
      state.value = await window.pods.resources(path.value.trim() ? { type: 'reviewDirectory', podId, epoch: state.value.epoch, path: path.value, access: access.value } : { type: 'pickDirectory', podId, epoch: state.value.epoch })
      const directory = state.value.resources.find(item => item.kind === 'directory' && item.state === 'ready' && ((path.value && item.configuration.path === path.value && (item.configuration.access === 'readWrite' || item.configuration.access === access.value)) || !before.resources.some(prior => prior.id === item.id && prior.revision === item.revision)))
      await resolve(directory, { provider: 'directory', description: request.value.description, instructions: request.value.instructions, path: String(directory?.configuration.path ?? path.value), access: (directory?.configuration.access as 'read' | 'readWrite' | undefined) ?? access.value })
      return
    }
    const selected = application.value
    if (!selected) throw new Error('Choose an application first')
    const argv = argumentsLine.value.trim() ? parseCommandLine(argumentsLine.value) : undefined
    if ((request.value.command || request.value.argv) && !argv) throw new Error('Enter exact program arguments before granting access')
    const networkHosts = hosts.value.split(/\s+/).filter(Boolean)
    if (networkHosts.length && JSON.stringify(selected.configuration.networkHosts) !== JSON.stringify(networkHosts)) {
      state.value = parseResourceState(await window.pods.programs({ type: 'network', podId, applicationId: selected.id, epoch: state.value.epoch, hosts: networkHosts }))
    }
    if (argv) state.value = parseResourceState(await window.pods.programs({ type: 'grant', podId, applicationId: selected.id, epoch: state.value.epoch, argv }))
    await resolve(state.value.resources.find(item => item.id === selected.id), { provider: 'application', description: request.value.description, instructions: request.value.instructions, application: selected.name, ...(argv ? { argv } : {}), networkHosts })
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Resource operation failed' }
  finally { busy.value = false }
}
async function addApplication(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    const previous = new Set(applications.value.map(item => item.id))
    state.value = parseResourceState(await window.pods.programs({ type: 'add', podId: props.proposal.podId, epoch: state.value.epoch, ...(request.value.application ? { suggestedName: request.value.application } : {}) }))
    applicationId.value = applications.value.find(item => !previous.has(item.id))?.id ?? applicationId.value
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Resource operation failed' }
  finally { busy.value = false }
}
</script>

<template>
  <div class="setup-review">
    <button v-if="!open" class="secondary" :disabled="busy" @click="review">
      {{ t(request.provider === 'variable' ? 'Answer question' : 'Review resources') }}
    </button>
    <form v-else @submit.prevent="apply">
      <template v-if="request.provider === 'http'">
        <label>{{ t('HTTPS origin') }}<input v-model="origin" type="url" required :disabled="busy"></label>
        <fieldset><legend>{{ t('Allowed methods') }}</legend><label v-for="method in ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']" :key="method"><input v-model="methods" type="checkbox" :value="method" :disabled="busy">{{ method }}</label></fieldset>
        <p v-if="!request.methods" class="muted">
          {{ t('This older request has no structured methods. Select the methods to allow.') }}
        </p>
      </template>
      <template v-else-if="request.provider === 'directory' || request.provider === 'reference'">
        <label v-if="request.provider === 'reference'">{{ t('Access type') }}<select v-model="referenceKind" :aria-label="t('Access type')" :disabled="busy"><option value="reference">{{ t('Read-only file snapshot') }}</option><option value="directory">{{ t('Direct folder access') }}</option></select></label>
        <p v-if="request.provider === 'reference' && referenceKind === 'reference'" class="muted">
          {{ t('Choose the source file in the next step. For a writable folder, select Direct folder access.') }}
        </p>
        <template v-if="request.provider === 'directory' || referenceKind === 'directory'">
          <label>{{ t('Folder path') }}<input v-model="path" :disabled="busy" :placeholder="t('Choose a folder in the next step')"></label>
          <label>{{ t('Directory permissions') }}<select v-model="access" :aria-label="t('Directory permissions')" :disabled="busy"><option value="read">{{ t('Read') }}</option><option value="readWrite">{{ t('Read and write') }}</option></select></label>
        </template>
      </template>
      <template v-else-if="request.provider === 'variable'">
        <p class="muted">
          {{ t('This answer is visible to the assistant. Do not enter passwords or tokens.') }}
        </p>
        <label>{{ request.alias }}<input v-model="value" required maxlength="2048" :disabled="busy"></label>
      </template>
      <template v-else-if="request.provider === 'application'">
        <label>{{ t('Application') }}<select v-model="applicationId" :aria-label="t('Application')" :disabled="busy"><option value="">{{ t('Choose an application first') }}</option><option v-for="item in applications" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <button type="button" class="secondary" :disabled="busy" @click="addApplication">
          {{ t('Add installed application…') }}
        </button>
        <label>{{ t('Program arguments') }}<input v-model="argumentsLine" :disabled="busy" :required="!!request.command || !!request.argv" :placeholder="t('Exact arguments, without the executable')"></label>
        <p v-if="request.command && !request.argv" class="muted">
          {{ t('The earlier command description is not executable. Enter exact arguments or ask the assistant to specify them.') }}
        </p>
        <label>{{ t('HTTPS hostnames, separated by spaces') }}<input v-model="hosts" :disabled="busy"></label>
        <p class="muted">
          {{ t('This grants access only. Sign-in and running the application are separate steps.') }}
        </p>
      </template>
      <div class="setup-actions">
        <button class="secondary" :disabled="busy || request.provider === 'http' && !methods.length || request.provider === 'application' && !application">
          {{ t(request.provider === 'variable' ? 'Save answer' : 'Review and allow') }}
        </button>
        <button type="button" class="text-button" :disabled="busy" @click="open = false">
          {{ t('Cancel') }}
        </button>
      </div>
    </form>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
    <p v-if="notice" role="status">
      {{ notice }}
    </p>
  </div>
</template>

<style scoped>
.setup-review { width:100%; min-width:0; }
form, label { display:grid; gap:8px; }
form { padding:16px 0; }
input, select { width:100%; min-width:0; box-sizing:border-box; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:inherit; font:inherit; }
fieldset { display:flex; flex-wrap:wrap; gap:12px; padding:10px 0; border:0; }
fieldset label { display:flex; align-items:center; }
fieldset input { width:auto; }
.setup-actions { display:flex; flex-wrap:wrap; gap:12px; }
p { overflow-wrap:anywhere; }
</style>
