<script lang="ts">
import { useHostBridge } from './host-bridge'
import { defineComponent, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import StorageRecovery from './StorageRecovery.vue'
import StartupScreen from './StartupScreen.vue'
import { accountReportKey, startupLimitMs, startupState } from './startup'
import type { StartupActionId, StartupState } from './startup'
import type { PodStatus } from '../contracts/ipc'
import type { OnboardingCommand, OnboardingView } from '../contracts/onboarding'

/**
 * Shows storage recovery while the database is not ready, and the startup status until the owner is signed in with
 * DDISA; only then the workspace opens. Synthetic fixture profiles have no DDISA owner and open the workspace directly.
 */
export default defineComponent({
  components: { StorageRecovery, StartupScreen },
  provide() { return { [accountReportKey as symbol]: (view: OnboardingView) => { this.accountChanged(view) } } },
  props: { shell: { type: Object as PropType<Component>, required: true } },
  setup() { return { hostBridge: useHostBridge() } },
  data() {
    return {
      status: null as PodStatus | null,
      view: null as OnboardingView | null,
      error: '',
      errorSource: null as 'action' | 'service' | null,
      email: '',
      editing: false,
      continued: false,
      opened: false,
      busy: false,
      overdue: false,
      issued: 0,
      unsubscribe: null as (() => void) | null,
      timer: null as ReturnType<typeof setTimeout> | null,
      deadline: null as ReturnType<typeof setTimeout> | null,
      workspace: markRaw(this.shell),
    }
  },
  computed: {
    recovery(): boolean { return this.status?.worker.state === 'recovery' },
    startup(): StartupState { return startupState({ status: this.status, view: this.view, error: this.error, errorSource: this.errorSource, overdue: this.overdue, editing: this.editing, continued: this.continued, email: this.email }) },
    gated(): boolean { return this.status?.mode !== 'fixture' && !this.opened },
  },
  watch: {
    'startup.id': function (id: string) {
      if (id === 'signed-in') this.opened = true
      if (id === 'checking') this.arm(); else this.disarm()
    },
  },
  async mounted() {
    this.unsubscribe = this.hostBridge.onStatus((status) => { this.status = status })
    this.arm()
    await this.readStatus()
    if (this.status) void this.poll()
    else this.timer = setTimeout(() => { void this.poll() }, 1000)
  },
  beforeUnmount() { this.opened = true; this.unsubscribe?.(); this.disarm(); if (this.timer) clearTimeout(this.timer) },
  methods: {
    arm() { if (!this.deadline) this.deadline = setTimeout(() => { this.overdue = true }, startupLimitMs) },
    disarm() { if (this.deadline) clearTimeout(this.deadline); this.deadline = null },
    async readStatus() {
      try { this.status = await this.hostBridge.getStatus(); if (this.errorSource === 'service' && !this.view) { this.error = ''; this.errorSource = null } }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); this.errorSource = 'service' }
    },
    /** Reads the account state every second until the workspace opens; it waits for the browser sign-in. */
    async poll() {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      if (this.opened) return
      if (!this.busy && !this.status) await this.readStatus()
      else if (!this.busy && this.status?.mode !== 'fixture' && this.status?.worker.state === 'ready') await this.request({ type: 'list' })
      if (!this.opened && !this.timer) this.timer = setTimeout(() => { void this.poll() }, 1000)
    },
    /**
     * The workspace's account button already reads the account every second; when the owner's DDISA connection ends
     * there (disconnected or expired), the workspace closes and the startup status takes over. Pods keep running.
     */
    accountChanged(view: OnboardingView) {
      const owner = view.connections.find(item => item.provider === 'openape')
      if (!this.opened || this.status?.mode === 'fixture' || (owner && owner.state !== 'revoked' && owner.state !== 'expired')) return
      this.view = view; this.error = ''; this.errorSource = null; this.editing = false; this.opened = false
      void this.poll()
    },
    async request(command: OnboardingCommand): Promise<boolean> {
      // Only the newest request applies: an account read issued before an owner action never overwrites its result.
      const id = ++this.issued
      try {
        const view = await this.hostBridge.onboarding(command)
        if (id !== this.issued) return true
        this.view = view
        if (command.type !== 'list' || this.errorSource === 'service') { this.error = ''; this.errorSource = null }
        return true
      }
      catch (error) {
        if (id !== this.issued) return false
        const message = error instanceof Error ? error.message : String(error)
        // A failed read keeps the last known state; only an unreadable first state is the service's failure.
        if (command.type !== 'list') { this.error = message; this.errorSource = 'action' }
        else if (!this.view) { this.error = message; this.errorSource = 'service' }
        return false
      }
    },
    async act(id: StartupActionId, email?: string) {
      if (this.busy) return
      if (id === 'continue') { this.continued = true; return }
      if (id === 'change-address') { this.editing = true; this.error = ''; this.errorSource = null; return }
      this.busy = true
      try {
        const owner = this.view?.connections.find(item => item.provider === 'openape')
        if (id === 'sign-in') {
          const account = email ?? (owner?.account || this.email)
          this.email = account; this.editing = false
          await this.request({ type: 'connect', provider: 'openape', account })
        }
        if ((id === 'reopen-browser' || id === 'cancel') && owner) await this.request({ type: id === 'cancel' ? 'cancel' : 'openLogin', id: owner.id })
        if (id === 'retry') { this.overdue = false; this.error = ''; this.errorSource = null; await this.readStatus(); if (this.status?.worker.state === 'ready') await this.request({ type: 'list' }) }
        if (id === 'restart-local') {
          this.overdue = false; this.error = ''; this.errorSource = null; this.view = null
          if (!this.hostBridge.restart) throw new Error('Restarting the local service is unavailable; quit and reopen Pods')
          this.status = await this.hostBridge.restart()
        }
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); this.errorSource = 'service' }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <StorageRecovery v-if="recovery" :failure="status?.worker.storage ?? null" />
  <StartupScreen v-else-if="gated" :key="startup.id" :state="startup" :busy="busy" @action="act" />
  <component :is="workspace" v-else />
</template>
