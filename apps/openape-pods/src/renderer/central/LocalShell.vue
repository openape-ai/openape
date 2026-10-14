<script setup lang="ts">
import { useHostBridge } from '../host-bridge'
import { localWorkspaceAccess } from '../workspace-access'
import WorkspaceShell from './WorkspaceShell.vue'

defineProps<{ sharing?: boolean, paused?: boolean }>()
const emit = defineEmits<{ openPod: [id: string], settings: [] }>()
const access = localWorkspaceAccess(useHostBridge())
</script>

<template>
  <WorkspaceShell :access="access" :sharing="sharing" :paused="paused" @open-pod="emit('openPod', $event)" @settings="emit('settings')" />
</template>
