<script setup lang="ts">
// Top-level switch between the three ways the Owner looks at troop:
//   Firmen  — the business view: companies and their hierarchies.
//   Nests   — the operations view: devices and the agents running on them.
//   Chat    — the reactive cockpit: talk to your companies' CEOs.
defineProps<{ active: 'companies' | 'nests' | 'chat' }>()
</script>

<template>
  <div class="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
    <UButton
      to="/companies"
      :color="active === 'companies' ? 'primary' : 'neutral'"
      :variant="active === 'companies' ? 'solid' : 'ghost'"
      size="sm"
      icon="i-lucide-building-2"
    >
      Firmen
    </UButton>
    <UButton
      to="/nests"
      :color="active === 'nests' ? 'primary' : 'neutral'"
      :variant="active === 'nests' ? 'solid' : 'ghost'"
      size="sm"
      icon="i-lucide-server"
    >
      Nests
    </UButton>
    <UButton
      to="/chat"
      :color="active === 'chat' ? 'primary' : 'neutral'"
      :variant="active === 'chat' ? 'solid' : 'ghost'"
      size="sm"
      icon="i-lucide-messages-square"
    >
      Chat
    </UButton>
  </div>
</template>
