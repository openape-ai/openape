<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DirectoryAccess, ResourceState, PodResource } from '../contracts/resources'
import { t } from './i18n'

const props = defineProps<{ state: ResourceState, busy: boolean }>()
const emit = defineEmits<{ add: [], revoke: [resource: PodResource], access: [resource: PodResource, access: DirectoryAccess] }>()
const selection = ref('')
const references = computed(() => props.state.resources.filter(resource => ['reference', 'directory'].includes(resource.kind) && resource.state !== 'revoked'))
const selected = computed(() => references.value.find(resource => resource.id === selection.value))
const fixed = computed(() => {
  if (!props.state.directories) return []
  return [
    { id: 'home', name: 'HOME', path: props.state.directories.home },
    { id: 'workspace', name: t('Working directory'), path: props.state.directories.workspace },
  ]
})
function changeAccess(resource: PodResource, event: Event): void {
  const select = event.target as HTMLSelectElement
  const access = select.value as DirectoryAccess
  select.value = resource.configuration.access as string
  emit('access', resource, access)
}
</script>

<template>
  <section>
    <h3>{{ t('Directory permissions') }}</h3>
    <div class="directory-list" role="group" :aria-label="t('Directory permissions')">
      <article v-for="directory in fixed" :key="directory.id" class="directory-row fixed-directory">
        <svg class="directory-icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10l3 3h13v16H3z" /></svg>
        <span class="directory-label"><strong>{{ directory.name }}</strong><span class="directory-path">{{ directory.path }}</span><small>{{ t('Read and write · belongs to this pod') }}</small></span>
      </article>
      <article v-for="resource in references" :key="resource.id" class="directory-row" :class="{ selected: selection === resource.id }">
        <button class="directory-select" :aria-pressed="selection === resource.id" @click="selection = resource.id">
          <svg class="directory-icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path :d="resource.kind === 'directory' ? 'M3 8h10l3 3h13v16H3z' : 'M7 3h12l6 6v20H7zM19 3v7h6'" /></svg>
          <span class="directory-label"><strong>{{ resource.name }}</strong><span class="directory-path">{{ resource.configuration.path }}</span><small>{{ t(resource.kind === 'reference' ? 'Read-only snapshots' : 'Direct folder access') }}</small></span>
        </button>
        <select v-if="resource.kind === 'directory'" :value="resource.configuration.access" :aria-label="t('Access for {name}', { name: resource.name })" :disabled="busy" @change="changeAccess(resource, $event)">
          <option value="read">
            {{ t('Read') }}
          </option>
          <option value="readWrite">
            {{ t('Read and write') }}
          </option>
        </select>
      </article>
      <footer class="directory-toolbar">
        <button class="text-button" :aria-label="t('Add directory')" :title="t('Add directory')" :disabled="busy" @click="emit('add')">
          ＋
        </button>
        <button class="text-button" :aria-label="t('Remove directory access')" :title="t('Remove directory access')" :disabled="busy || !selected" @click="selected && emit('revoke', selected)">
          −
        </button>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.directory-list { container-type:inline-size; background:var(--surface); border:1px solid var(--border); border-radius:12px; margin:16px 0; overflow:hidden; }
.directory-row { display:flex; align-items:center; gap:14px; padding:12px 18px; border-bottom:1px solid var(--border); }
.directory-row.selected { background:var(--border); }
.directory-select { display:flex; flex:1; align-items:center; gap:14px; min-width:0; padding:0; border:0; background:none; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.directory-icon { width:32px; height:32px; flex-shrink:0; }
.directory-label { display:grid; gap:4px; min-width:0; overflow-wrap:anywhere; }
.directory-label strong { font-size:15px; font-weight:500; }
.directory-path, .directory-label small { color:var(--muted); font-size:12px; }
select { max-width:160px; padding:7px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:inherit; font:inherit; }
.directory-toolbar { display:flex; padding:6px 12px; }
.directory-toolbar button { font-size:23px; line-height:1; padding:2px 10px; margin:0; }
.directory-toolbar button + button { border-left:1px solid var(--border); border-radius:0; }
@container (max-width: 480px) {
  .directory-row { flex-wrap:wrap; }
  .directory-select { flex-basis:100%; }
  .fixed-directory .directory-label { flex:1; }
  select { margin-left:46px; max-width:calc(100% - 46px); }
}
</style>
