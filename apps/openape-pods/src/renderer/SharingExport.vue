<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PortableExportChoices, PortableExportReviewView, PortableSourceSelection, PortableSourceView, SharingCommand, SharingState } from '../contracts/sharing'
import { diagnostic, t } from './i18n'

// Export is a desktop flow: the reviewed package is saved as a file through a native dialog.
const props = defineProps<{ selection: PortableSourceSelection, api: (command: SharingCommand) => Promise<SharingState> }>()
const emit = defineEmits<{ done: [] }>()
const source = ref<PortableSourceView | null>(null)
const review = ref<PortableExportReviewView | null>(null)
const busy = ref(false); const error = ref(''); const notice = ref('')
const title = ref(''); const key = ref('package'); const revision = ref(1); const description = ref('')
const podKeys = ref<Record<string, string>>({}); const included = ref<Record<string, boolean>>({}); const aliases = ref<Record<string, string>>({}); const defaults = ref<Record<string, boolean>>({})
const compositionKeys = ref<Record<string, string>>({})
const acknowledged = ref<Record<string, boolean>>({})
const fileKinds = { 'script': 'Script', 'package-manifest': 'Package manifest', 'package-lock': 'Dependency lock', 'asset': 'File', 'composition': 'Composition document', 'data-schema': 'Data schema' } as const
const findingKinds = { 'local-reference': 'Local reference', 'local-path': 'Local path', 'private-key': 'Private key', 'private-value': 'Private value', 'possible-credential': 'Possible credential', 'opaque-asset': 'Unscannable file' } as const
const key36 = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 64) || 'item'
// Package paths allow only word characters, dots and hyphens; equal names in different Pods stay apart through the Pod key.
const assetName = (value: string) => value.replace(/[^\w.-]+/g, '_').replace(/^[.-]+/, '') || 'file'
// Two sources with the same name get numbered keys instead of colliding at review.
function uniqueKeys(items: { id: string, name: string }[], chosen: Record<string, string>, normalize = key36): Record<string, string> {
  const seen = new Map<string, number>(); const result: Record<string, string> = {}
  for (const item of items) {
    const base = chosen[item.id] || normalize(item.name); const count = seen.get(base) ?? 0
    seen.set(base, count + 1); result[item.id] = count ? `${base}_${count + 1}` : base
  }
  return result
}
const blocked = computed(() => review.value?.findings.some(finding => finding.severity === 'block') ?? false)
const acknowledgedAll = computed(() => review.value?.findings.filter(finding => finding.severity === 'review').every(finding => acknowledged.value[finding.id]) ?? false)
const effectivePodKeys = computed(() => uniqueKeys((source.value?.pods ?? []).map(pod => ({ id: pod.podId, name: pod.name })), podKeys.value))
const effectiveCompositionKeys = computed(() => uniqueKeys(source.value?.compositions ?? [], compositionKeys.value))
const choices = computed<PortableExportChoices>(() => ({
  package: { key: key.value, revision: Number(revision.value), title: title.value, description: description.value },
  pods: (source.value?.pods ?? []).map(pod => ({
    podId: pod.podId, key: effectivePodKeys.value[pod.podId]!, description: '',
    defaults: [...pod.variables.filter(name => defaults.value[`${pod.podId}/variable:${name}`]).map(name => `variable:${name}`), ...pod.configuration.filter(name => defaults.value[`${pod.podId}/configuration:${name}`]).map(name => `configuration:${name}`)],
    aliases: pod.aliasable.map(resource => ({ resourceId: resource.id, alias: aliases.value[resource.id] || key36(resource.name) })),
    assets: pod.references.filter(reference => included.value[reference.id]).map((reference, _, chosen) => ({ resourceId: reference.id, path: `assets/${effectivePodKeys.value[pod.podId]}/${uniqueKeys(chosen, {}, assetName)[reference.id]}`, mediaType: 'application/octet-stream' })),
    omittedReferences: pod.references.filter(reference => !included.value[reference.id]).map(reference => reference.id),
  })),
  compositions: (source.value?.compositions ?? []).map(item => ({ id: item.id, key: effectiveCompositionKeys.value[item.id]!, defaults: [] })),
}))
async function perform(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() }
  catch (failure) { error.value = failure instanceof Error ? failure.message : 'Sharing operation failed' }
  finally { busy.value = false }
}
function load() {
  return perform(async () => {
    const state = await props.api({ scope: 'export', type: 'inspectSource', selection: props.selection })
    source.value = state.source ?? null
    const name = source.value?.compositions[0]?.name ?? source.value?.pods[0]?.name ?? ''
    if (!title.value) { title.value = name; key.value = key36(name) }
  })
}
function prepare() {
  return perform(async () => {
    const state = await props.api({ scope: 'export', type: 'review', selection: props.selection, choices: choices.value })
    review.value = state.review ?? null; acknowledged.value = {}
    notice.value = t('Review the exact package below. The review expires after ten minutes.')
  })
}
async function release(): Promise<void> {
  const pending = review.value; review.value = null
  if (pending) await props.api({ scope: 'export', type: 'discard', id: pending.id })
}
const discard = () => perform(release)
function download() {
  return perform(async () => {
    const state = await props.api({ scope: 'export', type: 'download', id: review.value!.id, acknowledgedFindings: Object.keys(acknowledged.value).filter(id => acknowledged.value[id]) })
    if (!state.saved) { notice.value = t('Saving was cancelled; the review stays valid until it expires.'); return }
    await release(); notice.value = t('Package saved to {path}', { path: state.saved }); emit('done')
  })
}
onMounted(load)
// A review that nobody downloads is released, so pending reviews never pile up to their limit.
onBeforeUnmount(() => { void release().catch(() => {}) })
</script>

<template>
  <section class="sharing-export" aria-labelledby="sharing-export-heading">
    <h1 id="sharing-export-heading">
      {{ t('Share as portable package') }}
    </h1>
    <p class="muted">
      {{ t('The package contains the selected scripts, dependency locks, declarations and chosen files. Credentials, run history, private folders and local identities never leave this device.') }}
    </p>
    <p v-if="error" role="alert">
      {{ diagnostic(error) }}
    </p>
    <p v-else-if="notice" role="status">
      {{ notice }}
    </p>
    <fieldset v-if="source && !review" :disabled="busy">
      <legend>{{ t('Package') }}</legend>
      <label>{{ t('Title') }}<input v-model="title" maxlength="120"></label>
      <label>{{ t('Package key') }}<input v-model="key" maxlength="64" pattern="[a-z][a-z0-9_-]*"></label>
      <label>{{ t('Revision') }}<input v-model.number="revision" type="number" min="1"></label>
      <label>{{ t('Description') }}<textarea v-model="description" rows="2" maxlength="2000" /></label>
    </fieldset>
    <fieldset v-for="pod in source?.pods ?? []" v-show="!review" :key="pod.podId" :disabled="busy">
      <legend>{{ pod.name }}</legend>
      <label>{{ t('Pod key') }}<input :value="podKeys[pod.podId] ?? effectivePodKeys[pod.podId]" maxlength="64" @input="podKeys[pod.podId] = ($event.target as HTMLInputElement).value"></label>
      <p v-if="pod.references.length" class="muted">
        {{ t('Files: include each reference as a package asset or leave it out. Included files are copied into the package.') }}
      </p>
      <label v-for="reference in pod.references" :key="reference.id" class="check"><input v-model="included[reference.id]" type="checkbox"> {{ t('Include {name}', { name: reference.name }) }}</label>
      <label v-for="resource in pod.aliasable" :key="resource.id">{{ t('Alias for {name}', { name: resource.name }) }}<input :value="aliases[resource.id] ?? key36(resource.name)" maxlength="64" @input="aliases[resource.id] = ($event.target as HTMLInputElement).value"></label>
      <p v-if="pod.variables.length || pod.configuration.length" class="muted">
        {{ t('Values: recipients enter every value themselves unless you include yours as a public default.') }}
      </p>
      <label v-for="name in pod.variables" :key="`v:${name}`" class="check"><input v-model="defaults[`${pod.podId}/variable:${name}`]" type="checkbox"> {{ t('Include default for {name}', { name }) }}</label>
      <label v-for="name in pod.configuration" :key="`c:${name}`" class="check"><input v-model="defaults[`${pod.podId}/configuration:${name}`]" type="checkbox"> {{ t('Include default for {name}', { name }) }}</label>
    </fieldset>
    <fieldset v-if="source?.compositions.length && !review" :disabled="busy">
      <legend>{{ t('Compositions') }}</legend>
      <label v-for="item in source.compositions" :key="item.id">{{ t('Key for {name}', { name: item.name }) }}<input :value="compositionKeys[item.id] ?? effectiveCompositionKeys[item.id]" maxlength="64" @input="compositionKeys[item.id] = ($event.target as HTMLInputElement).value"></label>
    </fieldset>
    <div v-if="source && !review" class="sharing-actions">
      <button class="primary" :disabled="busy" @click="prepare">
        {{ t('Review package') }}
      </button>
    </div>
    <article v-if="review" class="sharing-review" aria-labelledby="sharing-review-heading">
      <h2 id="sharing-review-heading">
        {{ review.manifest.package.title }} <span class="muted">{{ t('revision {revision}', { revision: review.manifest.package.revision }) }}</span>
      </h2>
      <p class="muted">
        {{ t('Pods: {count}', { count: review.manifest.pods.length }) }} · {{ t('Compositions: {count}', { count: review.manifest.compositions.length }) }} · {{ t('Files: {count}', { count: review.manifest.files.length }) }} · {{ t('Content digest {digest}', { digest: review.manifest.contentSha256.slice(0, 16) }) }}
      </p>
      <ul class="sharing-files" :aria-label="t('Files')">
        <li v-for="file in review.manifest.files" :key="file.path">
          {{ file.path }} <span class="muted">{{ t(fileKinds[file.kind]) }} · {{ t('{count} bytes', { count: file.bytes }) }}</span>
        </li>
      </ul>
      <template v-if="review.findings.length">
        <h3>{{ t('Privacy findings') }}</h3>
        <ul class="sharing-findings">
          <li v-for="finding in review.findings" :key="finding.id">
            <strong>{{ finding.severity === 'block' ? t('Blocked') : t('Needs review') }}</strong> {{ finding.path }}<span v-if="finding.line !== null">:{{ finding.line }}</span> · {{ t(findingKinds[finding.kind]) }}
            <label v-if="finding.severity === 'review'" class="check"><input v-model="acknowledged[finding.id]" type="checkbox"> {{ t('I reviewed this and want to share it') }}</label>
          </li>
        </ul>
        <p v-if="blocked" role="alert">
          {{ t('Parameterize machine-bound or private content before exporting') }}
        </p>
      </template>
      <p class="muted">
        {{ t('A heuristic scan cannot prove that arbitrary code or files contain no private data. Read the source before sharing it.') }}
      </p>
      <div class="sharing-actions">
        <button class="primary" :disabled="busy || blocked || !acknowledgedAll" :title="blocked ? t('Parameterize machine-bound or private content before exporting') : acknowledgedAll ? undefined : t('Acknowledge every finding first')" @click="download">
          {{ t('Save package…') }}
        </button>
        <button class="secondary" :disabled="busy" @click="discard">
          {{ t('Change selection') }}
        </button>
      </div>
    </article>
  </section>
</template>
