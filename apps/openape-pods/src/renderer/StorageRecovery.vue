<script lang="ts">
import { useHostBridge } from './host-bridge'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { t, diagnostic, dateTime, number } from './i18n'
import type { MessageKey } from '../i18n'
import type { StorageFailure, StorageReason, StorageRecoveryCommand, StorageRecoveryView } from '../contracts/storage'

const explanations: Record<StorageReason, MessageKey> = {
  'busy': 'Another process holds the database. Close other copies of Pods or tools that opened it, then try again.',
  'disk-full': 'The disk is full. Free space on this Mac, then try again.',
  'permission': 'Pods may not read or write its database. Check the folder permissions, then try again.',
  'io': 'The disk reported a read or write error. Save a recovery copy before anything else.',
  'schema-newer': 'This data was written by a newer Pods version. Install that version again; this version does not change the data.',
  'schema-older': 'This data is too old for this Pods version. Open it with the previous version first or restore a newer backup.',
  'conversion-blocked': 'The data still contains open legacy work that cannot be converted safely. Open the previous version, finish or reconcile that work, then update again.',
  'invalid-data': 'The database structure differs from what Pods expects. Save a recovery copy and restore a verified backup.',
  'corrupt': 'SQLite reported damaged data. Save a recovery copy and restore a verified backup; Pods does not repair it silently.',
  'missing': 'The database of this profile is missing while its other data remains. Restore a backup or put the database file back; Pods does not start empty over it.',
  'timeout': 'Opening the database takes unusually long. Try again; if it repeats, save a recovery copy.',
  'unknown': 'The database could not be opened. Save a recovery copy, then try again or restore a verified backup.',
}

export default defineComponent({
  props: { failure: { type: Object as PropType<StorageFailure | null>, default: null } },
  setup() { return { hostBridge: useHostBridge() } },
  data() { return { view: null as StorageRecoveryView | null, error: '', busy: false } },
  computed: {
    reason(): StorageReason { return this.failure?.reason ?? this.view?.failure?.reason ?? 'unknown' },
    explanation(): string { return t(explanations[this.reason]) },
    validBackups(): number { return this.view?.backups.filter(backup => backup.valid).length ?? 0 },
  },
  async mounted() { await this.run({ type: 'view' }) },
  methods: {
    t, diagnostic, dateTime, number,
    async run(command: StorageRecoveryCommand) {
      if (!this.hostBridge.storage) return
      this.busy = true; this.error = ''
      try { this.view = await this.hostBridge.storage(command) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Storage recovery failed' }
      finally { this.busy = false }
    },
    size(bytes: number): string { return bytes < 0 ? t('unreadable') : `${number(Math.round(bytes / 1024))} KiB` },
  },
})
</script>

<template>
  <main class="storage-recovery" data-testid="storage-recovery">
    <h1>{{ t('Storage is not ready') }}</h1>
    <p class="fixture-note" role="alert">
      <strong>{{ explanation }}</strong><br>
      <span class="muted">{{ diagnostic(failure?.message ?? view?.failure?.message ?? '') }}</span>
    </p>
    <p>{{ t('Automatic runs are stopped. No Pod runs, takes work or acts until storage is ready again.') }}</p>
    <div class="actions">
      <button :disabled="busy" @click="run({ type: 'retry' })">
        {{ t('Try again') }}
      </button>
      <button class="secondary" :disabled="busy" @click="run({ type: 'preserve' })">
        {{ t('Save a recovery copy') }}
      </button>
      <button class="secondary" :disabled="busy" @click="run({ type: 'openFolder' })">
        {{ t('Show profile folder') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <section v-if="view">
      <h2>{{ t('Verified backups') }}</h2>
      <p v-if="!validBackups" class="muted" data-testid="no-backup">
        {{ t('No verified backup is available. Restoring is not possible; data written since the damage may be lost. Save a recovery copy before you change anything.') }}
      </p>
      <ul class="plain-list">
        <li v-for="backup in view.backups" :key="backup.path">
          <span>{{ backup.createdAt ? dateTime(backup.createdAt) : backup.path }}</span>
          <span class="muted"> · {{ backup.valid ? t('verified') : diagnostic(backup.problem) }} · {{ size(backup.bytes) }}</span>
          <button v-if="backup.valid" class="secondary" :disabled="busy" @click="run({ type: 'restore', path: backup.path })">
            {{ t('Restore this backup') }}
          </button>
        </li>
      </ul>
      <p v-if="view.lastAutomaticBackup.error" class="muted">
        {{ t('Last automatic backup failed: {reason}', { reason: diagnostic(view.lastAutomaticBackup.error) }) }}
      </p>
      <p class="muted">
        {{ t('Restoring creates a new profile from the backup; the current profile stays untouched. Progress since the backup is lost, and automation stays paused until you have checked external actions taken since then.') }}
      </p>
      <button class="secondary" :disabled="busy" @click="run({ type: 'restore', path: null })">
        {{ t('Choose another backup…') }}
      </button>
      <h2>{{ t('Diagnostics') }}</h2>
      <ul class="plain-list" data-testid="storage-files">
        <li v-for="file in view.diagnostics.files" :key="file.name">
          {{ file.name }} · {{ size(file.size) }} · {{ file.modifiedAt ? dateTime(file.modifiedAt) : '' }}
        </li>
        <li v-if="!view.diagnostics.files.length">
          {{ t('No database file found') }}
        </li>
        <li v-if="view.diagnostics.header">
          {{ view.diagnostics.header.sqlite ? t('SQLite header present, schema {schema}', { schema: String(view.diagnostics.header.schema) }) : t('No valid SQLite header') }}
        </li>
        <li v-if="view.diagnostics.freeBytes !== null">
          {{ t('Free disk space: {size}', { size: size(view.diagnostics.freeBytes) }) }}
        </li>
      </ul>
      <template v-if="view.recoveryCopies.length">
        <h2>{{ t('Recovery copies') }}</h2>
        <ul class="plain-list">
          <li v-for="copy in view.recoveryCopies" :key="copy">
            {{ copy }}
          </li>
        </ul>
      </template>
    </section>
  </main>
</template>

<style scoped>
.storage-recovery { max-width: 760px; margin: 0 auto; padding: 32px 24px; overflow-wrap: anywhere }
.storage-recovery .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 }
.storage-recovery li { margin: 6px 0 }
</style>
