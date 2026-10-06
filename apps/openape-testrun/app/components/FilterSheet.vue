<script setup lang="ts">
import { ref, watch } from 'vue'
import AppDialog from './AppDialog.vue'

export interface AdvancedFilter { access: string, team: string, field: string, value: string }
const props = defineProps<{ open: boolean, filter: AdvancedFilter, teams: { id: string, name: string }[], tags: string[] | null, selectedTags: string[] }>()
const emit = defineEmits<{ close: [], apply: [filter: AdvancedFilter], toggleTag: [tag: string] }>()
const draft = ref<AdvancedFilter>({ ...props.filter })
watch(() => props.open, (open) => { if (open) draft.value = { ...props.filter } })
const ACCESS = [['', 'Anyone I can see', ''], ['private', 'Only me', ''], ['readers', 'Named people', ''], ['team', 'A team', ''], ['link', 'Anyone with the link', 'Earlier uploads'], ['public', 'Public', '']] as const
</script>

<template>
  <AppDialog :open="open" title="Filters" @close="emit('close')">
    <fieldset v-if="tags" class="field">
      <legend>Tags</legend>
      <div class="tag-cloud">
        <button v-for="tag in tags" :key="tag" type="button" class="tag" :aria-pressed="selectedTags.includes(tag)" @click="emit('toggleTag', tag)">
          {{ tag }}
        </button>
      </div>
      <p class="hint">
        Showing the most used tags. Search finds all tags. Reports must have every selected tag.
      </p>
    </fieldset>
    <fieldset class="field">
      <legend>Who can open it</legend>
      <div class="radios">
        <label v-for="[value, label, note] in ACCESS" :key="value"><input v-model="draft.access" type="radio" name="f-access" :value="value"><span>{{ label }}<small v-if="note">{{ note }}</small></span></label>
      </div>
    </fieldset>
    <label class="field"><span>Team</span>
      <select v-model="draft.team">
        <option value="">All teams</option>
        <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
      </select>
    </label>
    <fieldset class="field">
      <legend>Publisher data</legend>
      <p class="hint">
        Match a value a publisher attached, for example plans.status is active.
      </p>
      <div class="pair">
        <label><span class="sr">Field</span><input v-model.trim="draft.field" placeholder="Field, e.g. tests.result"></label>
        <label><span class="sr">Value</span><input v-model.trim="draft.value" placeholder="Value, e.g. failed"></label>
      </div>
    </fieldset>
    <template #foot>
      <button class="btn quiet" type="button" @click="emit('apply', { access: '', team: '', field: '', value: '' })">
        Reset
      </button>
      <button class="btn primary" type="button" @click="emit('apply', draft)">
        Show results
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pair input { height: 38px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); border-radius: var(--radius-s); padding: 0 10px; width: 100%; font: inherit; }
p { margin: 0 0 6px; }
</style>
