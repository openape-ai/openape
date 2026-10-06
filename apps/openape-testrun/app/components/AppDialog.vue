<script setup lang="ts">
import { onMounted, ref, useId, watch } from 'vue'
import AppIcon from './AppIcon.vue'

// The native modal dialog makes the page inert, closes on Esc and returns focus on close.
const props = defineProps<{ open: boolean, title: string, center?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const headingId = useId()

function sync() {
  const element = dialog.value
  if (!element) return
  if (props.open && !element.open) element.showModal()
  if (!props.open && element.open) element.close()
}
watch(() => props.open, sync)
onMounted(sync)
function onBackdrop(event: MouseEvent) {
  if (event.target === dialog.value) emit('close')
}
defineExpose({ dialog })
</script>

<template>
  <dialog ref="dialog" class="panel" :class="{ center }" :aria-labelledby="headingId" @close="emit('close')" @click="onBackdrop">
    <div class="panel-h">
      <h2 :id="headingId">
        {{ title }}
      </h2>
      <button class="btn quiet icon" type="button" aria-label="Close" @click="emit('close')">
        <AppIcon name="x" />
      </button>
    </div>
    <div class="panel-b">
      <slot />
    </div>
    <div v-if="$slots.foot" class="panel-f">
      <slot name="foot" />
    </div>
  </dialog>
</template>

<style scoped>
.panel { color-scheme: var(--scheme); background: var(--paper); color: var(--ink); font: 15px/1.5 var(--font); border: 0; padding: 0; margin: 0 0 0 auto; width: min(420px, 100%); max-width: 100%; height: 100%; max-height: 100%; overflow: auto; flex-direction: column; box-shadow: -10px 0 30px rgba(0, 0, 0, .18); }
.panel[open] { display: flex; animation: slide-in .18s ease-out; }
.panel::backdrop { background: rgba(10, 14, 18, .38); }
.panel.center { margin: auto; height: fit-content; max-height: 90%; border-radius: var(--radius-l); width: min(480px, calc(100% - 32px)); animation: none; }
.panel-h { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--rule); position: sticky; top: 0; background: var(--paper); z-index: 1; }
.panel-h h2 { font-size: 17px; font-weight: 680; margin: 0; }
.panel-b { padding: 16px 18px; display: grid; gap: 18px; flex: 1; align-content: start; }
.panel-f { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--rule); position: sticky; bottom: 0; background: var(--paper); }
@keyframes slide-in { from { transform: translateX(24px); opacity: .6; } }
@keyframes sheet-up { from { transform: translateY(30px); opacity: .6; } }
@media (max-width: 760px) {
  .panel, .panel.center { margin: auto 0 0; height: fit-content; max-height: 88%; width: 100%; border-radius: var(--radius-l) var(--radius-l) 0 0; padding-bottom: var(--safe-bottom, 0px); }
  .panel[open] { animation: sheet-up .2s ease-out; }
}
</style>
