<script lang="ts">
import { t, diagnostic, label } from './i18n'
import { settingsDrafts } from './form-buffer'
import PodValues from './PodValues.vue'
import PodSchedule from './PodSchedule.vue'
import { defineComponent } from 'vue'
import type { Organization } from '../contracts/groups'
import type { StoredPod } from '../contracts/control'

export default defineComponent({
  components: { PodSchedule, PodValues },
  props: { showValues: Boolean, selectedPodId: { type: String, default: '' } },
  emits: ['selected'],
  data() { return { confirmReload: false, initialized: false, valuesExpanded: false, organization: { revision: 1, groups: [] } as Organization, pods: [] as StoredPod[], selectedId: '', name: '', revision: 0, error: '', message: '', busy: false } },
  computed: { selectedGroup(): string { return this.organization.groups.find(group => group.podIds.includes(this.selectedId))?.id ?? '' }, selectedPod(): StoredPod | undefined { return this.pods.find(pod => pod.id === this.selectedId) } },
  watch: { async selectedPodId(id: string) { if (id === this.selectedId) return; await this.reload(); const pod = this.pods.find(pod => pod.id === id); if (pod) this.select(pod); else this.newPod() } },
  async mounted() {
    await this.reload(); const selected = this.pods.find(pod => pod.id === this.selectedPodId); if (selected) {
      this.select(selected)
    }
    else { const draft = settingsDrafts.get(''); if (draft) Object.assign(this, draft); this.initialized = true }
  },
  beforeUnmount() { this.remember() },
  methods: {
    t, diagnostic, label,
    scrollValues() { if (this.showValues) document.getElementById('pod-values')?.scrollIntoView?.({ block: 'start' }) },
    async reloadSaved() {
      const id = this.selectedId
      this.error = ''; await this.reload(); if (this.error) return
      const saved = this.pods.find(pod => pod.id === id)
      if (!saved) { this.error = 'Saved pod is missing from response'; return }
      settingsDrafts.delete(id); this.initialized = false; this.select(saved); this.confirmReload = false
    },
    async reload() {
      this.busy = true
      try { const state = await window.pods.workspace({ type: 'list' }); this.pods = state.pods; this.organization = state.organization }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not load pods' }
      finally { this.busy = false }
    },
    async moveGroup(event: Event) {
      this.busy = true; this.error = ''
      try { const state = await window.pods.workspace({ type: 'organize', revision: this.organization.revision, action: 'move', podId: this.selectedId, groupId: (event.target as HTMLSelectElement).value || null }); this.organization = state.organization; this.$emit('selected', this.selectedId) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not update groups' }
      finally { this.busy = false; (event.target as HTMLSelectElement).value = this.selectedGroup }
    },
    remember() { if (!this.initialized) return; if (this.name !== (this.selectedPod?.name ?? '')) settingsDrafts.set(this.selectedId, { name: this.name, revision: this.revision }); else settingsDrafts.delete(this.selectedId) },
    select(pod: StoredPod) { this.remember(); const draft = settingsDrafts.get(pod.id); this.selectedId = pod.id; this.name = draft?.name ?? pod.name; this.revision = draft?.revision ?? pod.revision; this.initialized = true; this.$emit('selected', pod.id); this.message = ''; this.error = '' },
    newPod() { this.selectedId = ''; this.name = ''; this.revision = 0; this.$emit('selected', ''); this.message = ''; this.error = '' },
    async remove() {
      const pod = this.selectedPod; if (!pod || pod.lifecycle !== 'archived') return
      this.busy = true; this.error = ''
      try {
        await window.pods.data({ type: 'deletePod', podId: pod.id, revision: pod.revision, name: pod.name })
        await this.reload()
        if (!this.pods.some(item => item.id === pod.id)) { this.newPod(); this.message = 'Local pod deleted.' }
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not delete pod' }
      finally { this.busy = false }
    },
    async archive() {
      const pod = this.selectedPod; if (!pod) return
      this.busy = true; this.error = ''
      try { this.pods = (await window.pods.workspace({ type: 'update', id: pod.id, revision: pod.revision, name: pod.name, lifecycle: 'archived' })).pods; this.select(this.pods.find(item => item.id === pod.id)!); this.message = 'Archived. History is retained.' }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not archive pod' }
      finally { this.busy = false }
    },
    async save() {
      this.busy = true; this.error = ''; this.message = ''
      try {
        const command = this.selectedId ? { type: 'update' as const, id: this.selectedId, revision: this.revision, name: this.name, lifecycle: this.selectedPod!.lifecycle } : { type: 'create' as const, name: this.name }
        const state = await window.pods.workspace(command)
        this.pods = state.pods
        const saved = this.selectedId ? this.pods.find(pod => pod.id === this.selectedId) : this.pods.at(-1)
        if (!saved) throw new Error('Saved pod is missing from response')
        settingsDrafts.delete(this.selectedId); this.name = saved.name; this.select(saved); if (command.type === 'create') settingsDrafts.delete(''); this.message = 'Settings saved.'
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save pod' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <article class="card pod-settings">
    <div v-if="!selectedPodId" class="card-heading">
      <h2>{{ t("Local pods") }}</h2><button class="text-button" :disabled="busy" @click="newPod">
        {{ t("New local pod") }}
      </button>
    </div>
    <p class="muted">
      {{ t("Settings are saved on this Mac.") }}
    </p>
    <div v-if="!selectedPodId" class="saved-pods">
      <button v-for="pod in pods" :key="pod.id" class="secondary" :aria-pressed="selectedId === pod.id" @click="select(pod)">
        {{ pod.name }}
      </button>
    </div>
    <form @submit.prevent="save">
      <label>{{ t("Pod name") }}<input v-model="name" required maxlength="100" :disabled="busy"></label>
      <p v-if="!selectedPodId && revision" class="muted">
        {{ t("Settings revision {p0} · {p1}", { p0: revision, p1: label(selectedPod?.lifecycle) }) }}
      </p>
      <p v-if="error" role="alert" class="error-message">
        {{ diagnostic(error) }}
      </p>
      <div v-if="error && selectedId">
        <button class="text-button" type="button" @click="confirmReload = true">
          {{ t('Load saved settings') }}
        </button>
      </div>
      <div v-if="confirmReload" class="discard-prompt" role="alert">
        <p>{{ t('Discard unsaved settings and load saved values?') }}</p><button type="button" :disabled="busy" @click="reloadSaved">
          {{ t('Discard and reload') }}
        </button><button type="button" @click="confirmReload = false">
          {{ t('Keep editing') }}
        </button>
      </div>
      <p v-if="message" role="status">
        {{ diagnostic(message) }}
      </p>
      <button class="primary" type="submit" :disabled="busy || !name.trim()">
        {{ busy ? t("Saving…") : t("Save pod") }}
      </button>
    </form>
  </article>
  <article v-if="selectedPod" class="card">
    <label for="pod-group">{{ t('Group') }}</label><select id="pod-group" :value="selectedGroup" :disabled="busy" @change="moveGroup">
      <option value="">
        {{ t('Ungrouped') }}
      </option><option v-for="group in organization.groups" :key="group.id" :value="group.id">
        {{ group.name }}
      </option>
    </select>
  </article>
  <details v-if="selectedPod" :open="showValues" class="values-settings" @toggle="valuesExpanded = ($event.target as HTMLDetailsElement).open">
    <summary>{{ t('Variables and secrets') }}</summary><PodValues v-if="showValues || valuesExpanded" :key="selectedPod.id" :pod-id="selectedPod.id" @vue:mounted="scrollValues" />
  </details>
  <PodSchedule v-if="selectedPod" :key="selectedPod.id" :pod="selectedPod" @changed="reload" />
  <details v-if="selectedPod" class="card lifecycle-panel">
    <summary>{{ t("More options") }}</summary>
    <h2>{{ t("Pod lifecycle") }}</h2><p class="muted">
      {{ t("Archiving stops intake and preserves knowledge and run history.") }}
    </p><button class="secondary" :disabled="busy || selectedPod.lifecycle === 'archived'" @click="archive">
      {{ t("Archive pod") }}
    </button><button v-if="selectedPod.lifecycle === 'archived'" class="secondary" :disabled="busy" @click="remove">
      {{ t("Delete local pod…") }}
    </button>
    <p v-if="selectedPod.lifecycle === 'archived'" class="muted">
      {{ t("Deletion permanently removes this pod’s local data and key. Export a backup first. A separate confirmation follows.") }}
    </p>
  </details>
</template>

<style scoped>
.lifecycle-panel { margin-top:20px; } .lifecycle-panel button { margin-top:12px; }
.pod-settings { max-width: 780px; }
.saved-pods { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
form, label { display: grid; gap: 10px; }
form { gap: 20px; }
input, textarea, select { font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 8px; padding: 10px; width: 100%; box-sizing: border-box; }
form .primary { justify-self: start; }
</style>
