<script lang="ts">
import { defineComponent } from 'vue'
import { t, diagnostic } from './i18n'

export default defineComponent({
  data: () => ({ enabled: false, loaded: false, busy: false, error: '' }),
  async mounted() {
    try { this.enabled = (await window.pods.runtimeApproval({ type: 'get' })).enabled; this.loaded = true }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load automatic runtime approval' }
  },
  methods: {
    t, diagnostic,
    async change(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement
      const enabled = input.checked
      input.checked = this.enabled
      this.busy = true; this.error = ''
      try { this.enabled = (await window.pods.runtimeApproval({ type: 'set', enabled })).enabled }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save automatic runtime approval' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <div class="runtime-approval-settings">
    <label class="runtime-approval-option">
      <input type="checkbox" :checked="enabled" :disabled="!loaded || busy" aria-describedby="runtime-approval-help" @change="change">
      <span>{{ t('Automatically approve script execution for Pods created through local MCP') }}</span>
    </label>
    <p id="runtime-approval-help" class="muted">
      {{ t('Applies to manual and scheduled runs. Folder, program, network and secret permissions remain separate. Denied or revoked approvals stay blocked. Turning this off stops new automatic approvals; existing approvals remain valid until revoked.') }}
    </p>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </div>
</template>

<style scoped>
.runtime-approval-settings { margin-top: 24px; }
.runtime-approval-option { display: flex; align-items: flex-start; gap: 10px; }
.runtime-approval-option input { flex: 0 0 auto; width: auto; margin-top: 3px; }
</style>
