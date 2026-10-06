<script setup lang="ts">
import { ref, watch } from 'vue'
import { toastMessage } from '../utils/toast'

// A manual popover joins the top layer, so the message also shows above an open modal dialog.
const element = ref<HTMLElement>()
watch(toastMessage, (message) => {
  const toast = element.value
  if (!toast?.showPopover) return
  if (toast.matches(':popover-open')) toast.hidePopover()
  if (message) toast.showPopover()
})
</script>

<template>
  <p ref="element" class="toast" popover="manual" role="status" aria-live="polite">
    {{ toastMessage }}
  </p>
</template>

<style scoped>
.toast { position: fixed; inset: auto auto calc(24px + var(--safe-bottom, 0px)) 50%; transform: translateX(-50%); z-index: 80; background: var(--ink); color: var(--paper); padding: 10px 16px; border: 0; border-radius: var(--radius-m); font: 14px/1.5 var(--font); box-shadow: 0 8px 24px rgba(0, 0, 0, .2); max-width: calc(100% - 32px); margin: 0; }
</style>
