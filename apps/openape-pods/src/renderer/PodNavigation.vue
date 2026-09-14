<script setup lang="ts">
import { t, diagnostic, label } from './i18n'
import { computed, ref } from 'vue'
import type { StoredPod, WorkspaceState } from '../contracts/control'
import type { GroupAction, Organization, PodGroup } from '../contracts/groups'

const props = defineProps<{ pods: StoredPod[], podId: string, organization: Organization, available: boolean, highlight: boolean, hideGroupPicker?: boolean }>()
const emit = defineEmits<{ select: [id: string], updated: [state: WorkspaceState] }>()
const editRevision = ref(1)
const busy = ref(false); const error = ref(''); const editing = ref<string | null>(null); const name = ref(''); const removing = ref(false); const dragging = ref<string | null>(null)
const selected = computed(() => props.pods.find(pod => pod.id === props.podId))
const selectedGroup = computed(() => props.organization.groups.find(group => group.podIds.includes(props.podId))?.id ?? '')
const sections = computed(() => [
  ...props.organization.groups.map(group => ({ ...group, pods: props.pods.filter(pod => group.podIds.includes(pod.id)) })),
  { id: '', name: t('Ungrouped'), collapsed: false, pods: props.pods.filter(pod => !props.organization.groups.some(group => group.podIds.includes(pod.id))) },
])
function edit(group?: PodGroup) { editRevision.value = props.organization.revision; editing.value = group?.id ?? ''; name.value = group?.name ?? ''; removing.value = false; error.value = '' }
async function apply(action: GroupAction, revision = props.organization.revision): Promise<boolean> {
  if (busy.value || !props.available) return false
  busy.value = true; error.value = ''
  try { emit('updated', await window.pods.workspace({ type: 'organize', revision, ...action })); return true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update groups'; return false }
  finally { busy.value = false }
}
async function save() {
  if (editing.value === null) return
  if (await apply(editing.value ? { action: 'rename', id: editing.value, name: name.value } : { action: 'create', name: name.value }, editRevision.value)) editing.value = null
  else editRevision.value = props.organization.revision
}
async function remove() {
  if (!editing.value) return
  if (await apply({ action: 'remove', id: editing.value }, editRevision.value)) { editing.value = null; removing.value = false }
  else {
    editRevision.value = props.organization.revision
  }
}
async function move(event: Event) {
  const select = event.target as HTMLSelectElement
  await apply({ action: 'move', podId: props.podId, groupId: select.value || null })
  select.value = selectedGroup.value
}
function startDrag(event: DragEvent, id: string) {
  if (!event.dataTransfer || busy.value || !props.available) { event.preventDefault(); return }
  dragging.value = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id)
}
async function drop(groupId: string) {
  const podId = dragging.value; dragging.value = null
  if (podId) await apply({ action: 'move', podId, groupId: groupId || null })
}
</script>

<template>
  <div class="pod-navigation">
    <div class="group-tools">
      <span class="mini-label">{{ t("YOUR PODS · {p0}", { p0: pods.length }) }}</span>
      <button :disabled="busy || !available" :aria-label="t('New group')" @click="edit()">
        {{ t("＋ Group") }}
      </button>
    </div>
    <form v-if="editing !== null" class="group-form" :aria-label="t('Edit group')" @submit.prevent="save">
      <label>{{ t("Group name") }}<input v-model="name" maxlength="100" required :disabled="busy" autocomplete="off"></label>
      <div class="group-actions">
        <button class="secondary" type="submit" :disabled="busy || !available">
          {{ editing ? t("Save group") : t("Create group") }}
        </button>
        <button type="button" :disabled="busy" @click="editing = null">
          {{ t("Cancel") }}
        </button>
        <button v-if="editing" type="button" :disabled="busy || !available" @click="removing = true">
          {{ t("Remove group") }}
        </button>
      </div>
      <div v-if="removing" class="group-confirm">
        <p>{{ t("Remove this group? Its pods will move to Ungrouped.") }}</p>
        <button class="secondary" type="button" :disabled="busy || !available" @click="remove">
          {{ t("Confirm removal") }}
        </button>
      </div>
    </form>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <div class="pod-list">
      <section v-for="group in sections" :key="group.id" :aria-label="t('{group} group', { group: group.name })" class="pod-group" @dragover.prevent @drop.prevent="drop(group.id)">
        <div class="group-heading">
          <button v-if="group.id" :aria-expanded="!group.collapsed" :aria-controls="`group-${group.id}`" :disabled="busy || !available" class="group-toggle" @click="apply({ action: 'collapse', id: group.id, collapsed: !group.collapsed })">
            <span aria-hidden="true">{{ group.collapsed ? '▸' : '▾' }}</span><span class="group-name">{{ group.name }}</span><span>{{ group.pods.length }}</span>
          </button>
          <span v-else class="group-toggle"><span class="group-name">{{ t("Ungrouped") }}</span><span>{{ group.pods.length }}</span></span>
          <button v-if="group.id" :aria-label="t('Edit {group} group', { group: group.name })" :disabled="busy || !available" class="group-edit" @click="edit(organization.groups.find(item => item.id === group.id))">
            ⋯
          </button>
        </div>
        <div v-show="!group.collapsed" :id="`group-${group.id}`">
          <button v-for="pod in group.pods" :key="pod.id" class="pod-button" :class="{ active: pod.id === podId && highlight }" :aria-pressed="pod.id === podId && highlight" :draggable="available && !busy" @dragstart="startDrag($event, pod.id)" @dragend="dragging = null" @click="emit('select', pod.id)">
            <span class="pod-icon" aria-hidden="true">↗</span><span class="pod-name">{{ pod.name }}<small>{{ label(pod.lifecycle) }}</small></span>
          </button>
          <p v-if="!group.pods.length" class="group-empty muted">
            {{ pods.length ? t("No pods in this group") : t("No pods yet") }}
          </p>
        </div>
      </section>
    </div>
    <label v-if="selected && !hideGroupPicker" class="group-picker">{{ t("Group for {p0}", { p0: selected.name }) }}
      <select :aria-label="t('Group for {p0}', { p0: selected.name })" :value="selectedGroup" :disabled="busy || !available" @change="move">
        <option value="">{{ t("Ungrouped") }}</option>
        <option v-for="group in organization.groups" :key="group.id" :value="group.id">{{ group.name }}</option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.pod-navigation{display:flex;flex-direction:column;min-height:0;flex:1;margin-top:24px;gap:10px}
.group-tools,.group-heading,.group-toggle,.group-actions{display:flex;align-items:center;gap:6px}
.group-tools{justify-content:space-between;font-size:11px;flex-shrink:0}
.pod-list{overflow:auto;min-height:60px;flex:1}
.pod-group{margin-bottom:12px;min-width:0}
.group-heading{color:var(--muted);font-size:12px;min-width:0}
.group-toggle{flex:1;min-width:0;text-align:left;padding:8px 4px}
.group-name{flex:1;min-width:0;overflow-wrap:anywhere}
.group-edit{padding:7px;font-size:18px}
.pod-name{min-width:0;overflow-wrap:anywhere}
.pod-icon{flex-shrink:0}
.group-empty{font-size:11px;padding:4px 10px}
.group-form{padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);max-height:240px;overflow:auto;flex-shrink:0}
.group-form label,.group-picker{display:grid;gap:6px;font-size:11px;overflow-wrap:anywhere}
.group-form input,.group-picker select{width:100%;min-width:0;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px}
.group-actions{flex-wrap:wrap;margin-top:8px;font-size:11px}
.group-actions button,.group-confirm button{padding:7px}
.group-picker{flex-shrink:0}
.error-message{font-size:12px;overflow-wrap:anywhere}
</style>
