<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CentralCommand } from '../../contracts/central'
import type { MapTags } from '../../contracts/map-view'
import { normalizeTag, tagLimits } from '../../contracts/tags'
import { diagnostic, t } from '../i18n'

/** Own tags of one Pod or network; inherited network tags are shown, never edited here (issue 1459). */
const props = defineProps<{ id: string, tags: MapTags, suggestions: string[] }>()
const emit = defineEmits<{ command: [command: CentralCommand] }>()
const draft = ref([...props.tags.own])
const text = ref('')
const error = ref('')
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.tags.own))
const listId = computed(() => `tag-suggestions-${props.id}`)
function add() {
  error.value = ''
  if (!text.value.trim()) return
  try {
    const tag = normalizeTag(text.value)
    if (!draft.value.includes(tag)) {
      if (draft.value.length >= tagLimits.perItem) throw new Error('Too many tags')
      draft.value.push(tag)
    }
    text.value = ''
  }
  catch (failure) { error.value = diagnostic(failure instanceof Error ? failure.message : 'Invalid tag') }
}
function remove(tag: string) { draft.value = draft.value.filter(item => item !== tag) }
function save() { emit('command', { channel: 'workspace', body: { type: 'tag', id: props.id, revision: props.tags.revision, tags: draft.value } }) }
</script>

<template>
  <div class="tag-editor">
    <div class="tags">
      <span v-for="tag in draft" :key="tag" class="tag">{{ tag }}<button type="button" :aria-label="t('Remove tag {tag}', { tag })" @click="remove(tag)">×</button></span>
      <span v-for="tag in tags.inherited" :key="`inherited-${tag}`" class="tag inherited" :title="t('from network')">{{ tag }}</span>
    </div>
    <form class="add" @submit.prevent="add">
      <input v-model="text" :list="listId" :aria-label="t('Add tag')" :placeholder="t('Add tag')" maxlength="40">
      <datalist :id="listId">
        <option v-for="tag in suggestions.filter(item => !draft.includes(item))" :key="tag" :value="tag" />
      </datalist>
      <button class="secondary small" type="submit">
        {{ t('Add') }}
      </button>
      <button v-if="changed" class="small" type="button" @click="save">
        {{ t('Save tags') }}
      </button>
    </form>
    <p v-if="error" class="error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style>
.tag-editor{display:grid;gap:6px}
.tag-editor .tags,.tag-chips{display:flex;flex-wrap:wrap;gap:4px}
.tag-editor .tag,.tag-chips .tag{display:inline-flex;align-items:center;gap:2px;font-size:12px;border:1px solid var(--border);background:var(--tint);color:var(--accent);border-radius:12px;padding:1px 8px}
.tag-editor .tag button{border:0;background:none;color:var(--muted);padding:0 0 0 4px;font-size:13px;line-height:1}
.tag-editor .tag.inherited,.tag-chips .tag.inherited{color:var(--muted);background:transparent;border-style:dashed}
.tag-editor .add{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tag-editor input{font-size:13px;padding:4px 8px;min-width:0;flex:1 1 140px}
.tag-editor .error{color:var(--warn);font-size:13px;margin:0}
</style>
