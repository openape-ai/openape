<script setup lang="ts">
import { computed } from 'vue'

export type IconName = keyof typeof ICONS
const props = defineProps<{ name: IconName, small?: boolean }>()

const ICONS = {
  'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  'report': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  'plan': '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11"/><circle cx="5.2" cy="18" r="1.4"/>',
  'testrun': '<path d="M9 3h6M10 3v6l-5.4 9.4A2 2 0 0 0 6.3 21.5h11.4a2 2 0 0 0 1.7-3.1L14 9V3"/><path d="M7.2 15h9.6"/>',
  'all': '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  'person': '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  'agent': '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  'lock': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  'team': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.3-5 6.5-5s5.7 1.6 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.3 3.6 5"/>',
  'people': '<circle cx="10" cy="8" r="4"/><path d="M3 21c1-4 3.5-6 7-6 1.6 0 3 .4 4.1 1.1"/><path d="m15 19 2 2 4-4"/>',
  'link': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'download': '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  'panel': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  'back': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'history': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  'copy': '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  'restore': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  'sliders': '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  'x': '<path d="M6 6l12 12M18 6 6 18"/>',
  'shield': '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="M12 8v5M12 16v.5"/>',
  'check': '<path d="m5 12 4.5 4.5L19 7"/>',
  'alert': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  'network': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  'upload': '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  'mark': '<rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="currentColor" stroke="none"/><rect x="7" y="6.5" width="10" height="11" rx="1" fill="var(--mat)" stroke="none"/>',
} as const

const paths = computed(() => ICONS[props.name])
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- static, compile-time icon paths -->
  <svg class="i" :class="{ 'i-s': small }" viewBox="0 0 24 24" aria-hidden="true" v-html="paths" />
</template>

<style>
.i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.i-s { width: 15px; height: 15px; }
</style>
