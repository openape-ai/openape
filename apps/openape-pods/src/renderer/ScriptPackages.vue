<script lang="ts">
import { defineComponent } from 'vue'
import { parsePackages } from '../contracts/dependencies'
import type { PackageOption } from '../contracts/package-catalog'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { modelValue: { type: String, required: true }, disabled: Boolean },
  emits: ['update:modelValue'],
  data() { return { selected: '', adding: false, query: '', searching: false, searched: false, results: [] as PackageOption[], candidate: null as PackageOption | null, error: '', requestId: 0 } },
  computed: {
    packages(): Record<string, string> { return parsePackages(JSON.parse(this.modelValue)).dependencies },
  },
  beforeUnmount() { this.requestId++ },
  methods: {
    t, diagnostic,
    open() { this.adding = true; this.query = ''; this.results = []; this.candidate = null; this.error = ''; this.searched = false },
    close() { this.requestId++; this.adding = false; this.searching = false },
    async search() {
      if (this.disabled || this.searching || !this.query.trim()) return
      const request = ++this.requestId
      this.searching = true; this.error = ''; this.candidate = null; this.results = []; this.searched = false
      try { const results = await window.pods.packages({ query: this.query }); if (request === this.requestId) { this.results = results; this.searched = true } }
      catch (error) { if (request === this.requestId) this.error = error instanceof Error ? error.message : 'npm search failed. Check the package name and connection, then try again.' }
      finally { if (request === this.requestId) this.searching = false }
    },
    choose(item: PackageOption) { this.candidate = { ...item }; this.error = '' },
    add() {
      if (this.disabled || !this.candidate) return
      try {
        const packages = parsePackages({ dependencies: { ...this.packages, [this.candidate.name]: this.candidate.version.trim() } })
        this.$emit('update:modelValue', JSON.stringify(packages, null, 2)); this.selected = this.candidate.name; this.close()
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Invalid package.json' }
    },
    remove() {
      if (this.disabled || !this.selected) return
      const packages = { ...this.packages }; delete packages[this.selected]
      this.$emit('update:modelValue', JSON.stringify({ dependencies: packages }, null, 2)); this.selected = ''
    },
  },
})
</script>

<template>
  <div class="package-list" :aria-label="t('Script dependencies')">
    <p v-if="!Object.keys(packages).length" class="empty-packages">
      {{ t('No dependencies added.') }}
    </p>
    <button v-for="(version, name) in packages" :key="name" class="package-row" :class="{ selected: selected === name }" :aria-pressed="selected === name" @click="selected = name">
      <span class="package-icon" aria-hidden="true">◇</span><strong>{{ name }}</strong><code>{{ version }}</code>
    </button>
    <div class="package-toolbar">
      <button :disabled="disabled" :aria-label="t('Add dependency')" :title="t('Add dependency')" @click="open">
        +
      </button>
      <button :disabled="disabled || !selected || !packages[selected]" :aria-label="t('Remove dependency')" :title="t('Remove dependency')" @click="remove">
        −
      </button>
    </div>
  </div>
  <section v-if="adding" class="package-picker" :aria-label="t('Add dependency')">
    <form class="package-search" @submit.prevent="search">
      <label>{{ t('Search npm or paste an npm package URL') }}<input v-model="query" autofocus :disabled="disabled || searching" :placeholder="t('Package name, search term or npm URL')"></label>
      <button :disabled="disabled || searching || !query.trim()">
        {{ searching ? t('Searching…') : t('Search npm') }}
      </button>
    </form>
    <p class="muted">
      {{ t('Search uses the public npm registry. You can also enter name@1.2.3. Git and download URLs are not supported.') }}
    </p>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
    <p v-if="searched && !results.length" role="status">
      {{ t('No packages found.') }}
    </p>
    <div v-if="results.length" class="package-results" :aria-label="t('npm search results')">
      <button v-for="item in results" :key="item.name" class="package-result" :class="{ selected: candidate?.name === item.name }" :disabled="disabled" :aria-pressed="candidate?.name === item.name" @click="choose(item)">
        <span><strong>{{ item.name }}</strong> <code>{{ item.version }}</code></span><span class="muted">{{ item.description }}</span>
      </button>
    </div>
    <div v-if="candidate" class="package-choice">
      <strong>{{ candidate.name }}</strong><label>{{ t('Exact version') }}<input v-model="candidate.version" :disabled="disabled" spellcheck="false"></label>
      <button class="primary" :disabled="disabled || !candidate.version.trim()" @click="add">
        {{ packages[candidate.name] ? t('Update dependency') : t('Add dependency') }}
      </button>
    </div>
    <button class="text-button" @click="close">
      {{ t('Cancel') }}
    </button>
  </section>
</template>

<style scoped>
.package-list { border:1px solid var(--border); border-radius:14px; overflow:hidden; }
.empty-packages { padding:18px 20px; }
.package-row { display:flex; align-items:center; gap:14px; width:100%; border:0; border-bottom:1px solid var(--border); border-radius:0; padding:16px 20px; text-align:left; background:transparent; }
.package-row strong { flex:1; overflow-wrap:anywhere; min-width:0; }
.package-row code { color:var(--muted); flex-shrink:0; }
.package-icon { font-size:26px; color:var(--accent); }
.selected { background:var(--surface-soft, var(--bg)) !important; box-shadow:inset 3px 0 var(--accent); }
.package-toolbar { display:flex; align-items:center; padding:7px 12px; }
.package-toolbar button { border:0; border-radius:0; font-size:26px; line-height:1; min-width:42px; padding:3px 12px; background:transparent; color:var(--accent); }
.package-toolbar button + button { border-left:1px solid var(--border); }
.package-picker { margin-top:16px; padding:18px; border:1px solid var(--border); border-radius:12px; }
.package-search, .package-choice { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
.package-search label { flex:1; min-width:200px; }
label { display:grid; gap:6px; font-size:13px; }
input { box-sizing:border-box; width:100%; min-width:0; border:1px solid var(--border); border-radius:8px; padding:10px; font:inherit; background:var(--surface); color:var(--text); }
.package-picker p { font-size:13px; }
.package-results { max-height:270px; overflow:auto; border:1px solid var(--border); border-radius:8px; margin:12px 0; }
.package-result { display:grid; gap:4px; width:100%; border:0; border-bottom:1px solid var(--border); border-radius:0; text-align:left; background:transparent; padding:12px; overflow-wrap:anywhere; }
.package-result:last-child { border-bottom:0; }
.package-result code { margin-left:8px; color:var(--muted); }
.package-choice { margin:16px 0; }
.package-choice strong { align-self:center; flex:1; overflow-wrap:anywhere; }
.package-choice label { max-width:180px; }
</style>
