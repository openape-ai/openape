<script setup lang="ts">
defineProps<{ sealed?: boolean }>()
</script>

<template>
  <div class="reader surface">
    <slot name="bar" />
    <div class="frame" :class="{ sealed }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* Reading: the report fills everything below one slim bar, and the page itself never scrolls. */
.reader { display: flex; flex-direction: column; height: 100dvh; min-height: 0; padding-top: var(--safe-top, 0px); overflow: hidden; }
.frame { flex: 1; min-height: 0; background: var(--paper); overflow: hidden; position: relative; }
.frame.sealed { background: repeating-linear-gradient(135deg, var(--hatch-a) 0 14px, var(--hatch-b) 14px 28px); display: grid; place-items: center; padding: 20px; overflow: auto; }
</style>
