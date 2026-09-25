<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RunApproval } from '../contracts/activity'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { podId: { type: String, required: true }, approvals: { type: Array as PropType<(RunApproval & { runId: string })[]>, default: () => [] } },
  data() { return { busy: false, error: '' } },
  methods: {
    t, diagnostic,
    async open(approval: RunApproval & { runId: string }) {
      this.busy = true; this.error = ''
      try { await window.pods.runs({ type: 'openApproval', podId: this.podId, runId: approval.runId, grantId: approval.grantId }) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not open approval' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <section v-for="approval in approvals" :key="approval.grantId" class="approval-card" role="status">
    <strong>{{ t('Waiting for your approval') }}</strong>
    <p>{{ t('Review this permission in OpenApe. This run continues after approval.') }}</p>
    <p class="approval-title">
      {{ approval.permission?.startsWith('pod-runtime.pod[') ? t('Run the stored Pod script') : approval.title }}
    </p>
    <button class="primary" :disabled="busy" @click="open(approval)">
      {{ t('Open approval') }}
    </button>
    <p v-if="approval.openError" class="muted">
      {{ diagnostic(approval.openError) }}
    </p>
    <p v-if="error" role="alert">
      {{ diagnostic(error) }}
    </p>
  </section>
</template>

<style scoped>
.approval-card { margin: 20px 0; padding: 20px 24px; border: 1px solid #dacb96; border-radius: 12px; background: #fffbee; color: #69551f; }
.approval-card strong { font-size: 18px; } .approval-card p { margin: 8px 0 14px; } .approval-title { overflow-wrap: anywhere; font-size: 13px; }
</style>
