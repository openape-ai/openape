<script lang="ts">
import { useHostBridge } from './host-bridge'
import { defineComponent, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import StorageRecovery from './StorageRecovery.vue'
import type { PodStatus } from '../contracts/ipc'

/** Shows storage recovery instead of the workspace while the database is not ready; nothing else depends on it. */
export default defineComponent({
  components: { StorageRecovery },
  props: { shell: { type: Object as PropType<Component>, required: true } },
  setup() { return { hostBridge: useHostBridge() } },
  data() { return { status: null as PodStatus | null, unsubscribe: null as (() => void) | null, workspace: markRaw(this.shell) } },
  computed: { recovery(): boolean { return this.status?.worker.state === 'recovery' } },
  async mounted() {
    this.unsubscribe = this.hostBridge.onStatus((status) => { this.status = status })
    this.status = await this.hostBridge.getStatus()
  },
  beforeUnmount() { this.unsubscribe?.() },
})
</script>

<template>
  <StorageRecovery v-if="recovery" :failure="status?.worker.storage ?? null" />
  <component :is="workspace" v-else />
</template>
