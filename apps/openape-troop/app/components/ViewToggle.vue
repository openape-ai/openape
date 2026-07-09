<script setup lang="ts">
// Top-level switch: Firmen (business + org), Services (external sp-tasks queues
// the loop co-tends), Chat (the reactive cockpit). Nests fold into "providers" later.
defineProps<{ active: 'companies' | 'services' | 'nests' | 'chat' }>()
</script>

<template>
  <div class="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
    <UButton to="/companies" :color="active === 'companies' ? 'primary' : 'neutral'" :variant="active === 'companies' ? 'solid' : 'ghost'" size="sm" icon="i-lucide-building-2">
      Firmen
    </UButton>
    <UButton to="/services" :color="active === 'services' ? 'primary' : 'neutral'" :variant="active === 'services' ? 'solid' : 'ghost'" size="sm" icon="i-lucide-cable">
      Services
    </UButton>
    <UButton to="/chat" :color="active === 'chat' ? 'primary' : 'neutral'" :variant="active === 'chat' ? 'solid' : 'ghost'" size="sm" icon="i-lucide-messages-square">
      Chat
    </UButton>
  </div>
</template>
