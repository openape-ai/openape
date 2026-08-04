<script setup lang="ts">
// Top-level switch. Inbox first: it is where the owner actually works — the
// decisions waiting on them. Nests was declared in the prop type but never
// rendered, so /nests had no highlight and no way in.
defineProps<{ active: 'inbox' | 'companies' | 'services' | 'nests' | 'chat' | 'skills' }>()
</script>

<template>
  <div class="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
    <UButton to="/inbox" :color="active === 'inbox' ? 'primary' : 'neutral'" :variant="active === 'inbox' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-inbox" :aria-label="$t('nav.inbox')">
      <span class="hidden sm:inline">{{ $t('nav.inbox') }}</span>
    </UButton>
    <UButton to="/companies" :color="active === 'companies' ? 'primary' : 'neutral'" :variant="active === 'companies' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-building-2" :aria-label="$t('nav.companies')">
      <span class="hidden sm:inline">{{ $t('nav.companies') }}</span>
    </UButton>
    <UButton to="/services" :color="active === 'services' ? 'primary' : 'neutral'" :variant="active === 'services' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-cable" :aria-label="$t('nav.services')">
      <span class="hidden sm:inline">{{ $t('nav.services') }}</span>
    </UButton>
    <UButton to="/skills" :color="active === 'skills' ? 'primary' : 'neutral'" :variant="active === 'skills' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-wand-2" :aria-label="$t('nav.skills')">
      <span class="hidden sm:inline">{{ $t('nav.skills') }}</span>
    </UButton>
    <UButton to="/nests" :color="active === 'nests' ? 'primary' : 'neutral'" :variant="active === 'nests' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-server" :aria-label="$t('nav.nests')">
      <span class="hidden sm:inline">{{ $t('nav.nests') }}</span>
    </UButton>
    <UButton to="/chat" :color="active === 'chat' ? 'primary' : 'neutral'" :variant="active === 'chat' ? 'solid' : 'ghost'" size="sm" class="min-h-11 sm:min-h-0 px-3 sm:px-2.5" icon="i-lucide-messages-square" :aria-label="$t('nav.chat')">
      <span class="hidden sm:inline">{{ $t('nav.chat') }}</span>
    </UButton>
  </div>
</template>
