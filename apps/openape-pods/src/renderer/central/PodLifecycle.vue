<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../../contracts/control'
import type { CentralCommand } from '../../contracts/central'
import { t } from '../i18n'

export default defineComponent({
  props: { pod: { type: Object as PropType<StoredPod>, required: true } },
  emits: { command: (_command: CentralCommand) => true },
  data() { return { confirming: false } },
  methods: {
    t,
    archive() {
      this.$emit('command', { channel: 'workspace', body: { type: 'update', id: this.pod.id, revision: this.pod.revision, name: this.pod.name, lifecycle: 'archived' } })
    },
    remove() {
      if (!this.confirming || this.pod.lifecycle !== 'archived') return
      this.confirming = false
      this.$emit('command', { channel: 'data', body: { type: 'deletePod', podId: this.pod.id, revision: this.pod.revision, name: this.pod.name } })
    },
  },
})
</script>

<template>
  <section class="central-card pod-lifecycle">
    <h2>{{ t('Pod lifecycle') }}</h2>
    <p>{{ t('Archiving stops intake and preserves knowledge. Run history follows the 50-run retention policy.') }}</p>
    <button v-if="pod.lifecycle !== 'archived'" @click="archive">
      {{ t('Archive pod') }}
    </button>
    <button v-else-if="!confirming" @click="confirming = true">
      {{ t('Delete Pod…') }}
    </button>
    <p v-if="pod.lifecycle !== 'archived'">
      {{ t('Archive this Pod before deleting it.') }}
    </p>
    <div v-if="confirming" role="alertdialog" aria-labelledby="pod-deletion-title" aria-describedby="pod-deletion-detail">
      <h3 id="pod-deletion-title">
        {{ t('Permanently delete {p0}?', { p0: pod.name }) }}
      </h3>
      <p id="pod-deletion-detail">
        {{ t('This permanently removes this Pod’s workspace, scripts, knowledge, run history and local keys, including the current central copies. Shared accounts, original files, remote identities/grants, backups and shared chat history remain.') }}
      </p>
      <button @click="confirming = false">
        {{ t('Cancel') }}
      </button>
      <button class="danger" @click="remove">
        {{ t('Delete Pod') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
button { font: inherit; color: inherit; border: 1px solid var(--line); background: light-dark(white, #243038); border-radius: 6px; padding: 9px 12px; cursor: pointer; margin-right: 8px; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.danger { color: light-dark(#a32c25, #ffb8ac); border-color: currentColor; }
</style>
