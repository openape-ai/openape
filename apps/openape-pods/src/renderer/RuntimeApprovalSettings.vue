<script lang="ts">
import { defineComponent } from 'vue'
import type { RuntimeApprovalCommand } from '../contracts/runtime-approval'
import { t, diagnostic } from './i18n'

export default defineComponent({
  data: () => ({ enabled: false, standing: false, owner: null as string | null, scope: null as string | null, loaded: false, busy: false, error: '' }),
  async mounted() { await this.command({ type: 'get' }) },
  methods: {
    t, diagnostic,
    async command(command: RuntimeApprovalCommand): Promise<void> {
      this.busy = true; this.error = ''
      try {
        const state = await window.pods.runtimeApproval(command)
        this.enabled = state.enabled; this.standing = state.standing; this.owner = state.owner; this.scope = state.scope; this.loaded = true
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Could not save automatic runtime approval' }
      finally { this.busy = false }
    },
    async change(event: Event, type: 'set' | 'setStanding'): Promise<void> {
      const input = event.target as HTMLInputElement
      const enabled = input.checked
      input.checked = type === 'set' ? this.enabled : this.standing
      await this.command(type === 'setStanding' ? { type, enabled, scope: this.scope } : { type, enabled })
    },
  },
})
</script>

<template>
  <div class="runtime-approval-settings">
    <h3>{{ t('Script execution') }}</h3>
    <p v-if="owner" class="muted">
      {{ t('Runtime approval for {owner} on this device', { owner }) }}
    </p>
    <p v-else class="muted">
      {{ t('Connect this runtime and sign in with your DDISA account first') }}
    </p>
    <label class="standing-runtime-option">
      <input type="checkbox" :checked="standing" :disabled="!loaded || busy || !owner" aria-describedby="standing-runtime-help" @change="change($event, 'setStanding')">
      <span>{{ t('Always allow script execution for all my Pods on this runtime') }}</span>
    </label>
    <p id="standing-runtime-help" class="muted">
      {{ t('Includes existing and future Pods, manual runs, schedules and re-runs. Applies only to this account and runtime. This does not activate schedules.') }}
    </p>
    <label class="runtime-approval-option">
      <input type="checkbox" :checked="enabled" :disabled="!loaded || busy" aria-describedby="runtime-approval-help" @change="change($event, 'set')">
      <span>{{ t('Automatically approve script execution for Pods created through local MCP') }}</span>
    </label>
    <p id="runtime-approval-help" class="muted">
      {{ t('The local MCP option covers only locally created MCP Pods. Both options authorize script starts only. Mail, folder, program, network and secret permissions remain separate. Denied or revoked approvals stay blocked.') }}
    </p>
    <p class="muted">
      {{ t('To stop new automatic approvals, turn off both options. Existing approvals remain valid until revoked in grant management.') }}
    </p>
    <button class="secondary manage-runtime-grants" :disabled="!loaded || busy || !owner" @click="command({ type: 'manage' })">
      {{ t('Manage and revoke existing grants') }}
    </button>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
  </div>
</template>

<style scoped>
.runtime-approval-settings { margin-top: 24px; }
.runtime-approval-option, .standing-runtime-option { display: flex; align-items: flex-start; gap: 10px; }
.runtime-approval-option input, .standing-runtime-option input { flex: 0 0 auto; width: auto; margin-top: 3px; }
</style>
