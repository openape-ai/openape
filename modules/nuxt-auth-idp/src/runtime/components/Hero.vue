<script setup lang="ts">
// Single-decision screens — sign in, register, recover, consent — get the
// whole viewport and no page chrome. The counterpart to IdpPage.
</script>

<template>
  <div class="flex flex-1 flex-col items-center justify-center px-4 py-12">
    <div class="w-full max-w-md">
      <slot />
    </div>
  </div>
</template>
