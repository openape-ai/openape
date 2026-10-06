<script lang="ts">
import { t, diagnostic, label, number } from './i18n'
import { defineComponent } from 'vue'
import type { DataCommand, DataView } from '../contracts/data'

export default defineComponent({
  data() { return { view: null as DataView | null, limitGiB: 10, busy: false, error: '', notice: '' } },
  async mounted() { await this.perform({ type: 'status' }) },
  methods: {
    t, diagnostic, label, number,
    size(bytes: number): string { return `${number(bytes / 1024 ** 3, 2)} GiB` },
    async perform(command: DataCommand) {
      this.busy = true; this.error = ''; this.notice = ''
      try {
        this.view = await window.pods.data(command); this.limitGiB = this.view.limitBytes / 1024 ** 3
        if (command.type === 'cleanup') this.notice = 'Unused files cleaned. Referenced evidence and pending inputs are retained.'
        if (command.type === 'limit') this.notice = 'Storage limit saved.'
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Data operation failed' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section class="data-management" :aria-label="t('Data and backups')">
    <article class="card">
      <div class="card-heading">
        <h2>{{ t("Data & backups") }}</h2><button class="text-button" :disabled="busy" @click="perform({ type: 'status' })">
          {{ t("Refresh") }}
        </button>
      </div>
      <p class="muted">
        {{ t("Your workspace stays on this Mac. Stop or recover active runs and finish the master turn before maintenance.") }}
      </p>
      <p v-if="error || view?.error" role="alert" class="error-message">
        {{ diagnostic(error || view?.error) }}
      </p>
      <p v-if="notice" role="status">
        {{ diagnostic(notice) }}
      </p>
      <p v-if="busy" role="status">
        {{ t("Working…") }}
      </p>
      <template v-if="view">
        <dl><div><dt>{{ t("Application data") }}</dt><dd>{{ size(view.usedBytes) }}</dd></div><div><dt>{{ t("Disk available") }}</dt><dd>{{ size(view.freeBytes) }}</dd></div><div><dt>{{ t("Pending local deletions") }}</dt><dd>{{ view.pendingDeletion }}</dd></div></dl>
        <form @submit.prevent="perform({ type: 'limit', bytes: Math.round(limitGiB * 1024 ** 3) })">
          <label>{{ t("Storage limit (GiB)") }}<input v-model.number="limitGiB" type="number" min="1" max="1024" step="1" required :disabled="busy"></label>
          <button class="secondary" :disabled="busy">
            {{ t("Save storage limit") }}
          </button>
        </form>
        <p class="muted">
          {{ t("Checked every minute, and at once when the limit is reached or free space runs low. Runs stop when the limit is reached or less than 256 MiB remains free. Temporary usage can exceed the limit between checks.") }}
        </p>
        <button class="secondary" :disabled="busy || view.busy" @click="perform({ type: 'cleanup' })">
          {{ t("Clean unused files") }}
        </button>
        <p class="muted">
          {{ t("Each Pod keeps its newest 50 runs. Older runs are permanently removed from local and account history once active work, approvals, inputs and recovery are settled. Delivery receipts, Pod workspaces, settings, checkpoints and knowledge are preserved. Backups and old restored profiles remain separate.") }}
        </p>
      </template>
    </article>
    <article class="card">
      <h2>{{ t("Backup and recovery") }}</h2>
      <p>{{ t("Export pod settings, scripts, workspaces, knowledge, source snapshots and retained run history. Deleted runs cannot be recovered from a later backup. Backups contain your data; choose a private destination. Account credentials are excluded.") }}</p>
      <div class="actions">
        <button class="primary" :disabled="busy || !view || view.busy" @click="perform({ type: 'backup' })">
          {{ t("Export backup…") }}
        </button><button class="secondary" :disabled="busy || view?.busy" @click="perform({ type: 'restore' })">
          {{ t("Restore backup and restart…") }}
        </button>
      </div>
      <p class="muted">
        {{ t("Restoration verifies checksums and creates a new profile. The current profile is retained. Reconnect accounts, review resources and explicitly enable schedules after restoring.") }}
      </p>
      <p v-if="view?.result" class="result" role="status">
        {{ label(view.result.kind) }}: {{ view.result.path }}
      </p>
    </article>
    <article class="card">
      <h2>{{ t("Manual updates") }}</h2><p>{{ t("Choose a downloaded, signed OpenApe Pods app. Verification checks its publisher, version and database compatibility, then exports a backup before you install it.") }}</p><button class="secondary" :disabled="busy || !view || view.busy" @click="perform({ type: 'update' })">
        {{ t("Verify update and back up…") }}
      </button><p class="muted">
        {{ t("Quit Pods before replacing the app. To return to an earlier version, restore its compatible pre-update backup; never reuse a database migrated by a newer version.") }}
      </p>
    </article>
  </section>
</template>

<style scoped>
.data-management { display:grid; gap:20px; } .data-management p { line-height:1.6; } dl { display:flex; flex-wrap:wrap; gap:24px; } dt { font-size:13px; } dd { margin:6px 0; font-weight:600; } form,.actions { display:flex; align-items:end; flex-wrap:wrap; gap:12px; } label { display:grid; gap:8px; } input { max-width:150px; padding:10px; border:1px solid currentColor; border-radius:8px; background:transparent; color:inherit; font:inherit; } .result { overflow-wrap:anywhere; }
</style>
