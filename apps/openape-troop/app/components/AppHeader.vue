<script setup lang="ts">
// The one header every signed-in page wears. It is a component and not a Nuxt
// layout on purpose: `app.vue` is bare (`UApp > NuxtPage`), and a
// `layouts/default.vue` would also reach the start page, login, /agents and
// /docs — pages that carry no header and would each need an opt-out.
//
// The styles live here rather than in `assets/css/main.css` so the geometry
// travels with the markup and can be measured in the browser suite.

type View = 'inbox' | 'companies' | 'services' | 'nests' | 'chat' | 'skills'

withDefaults(defineProps<{
  /** Highlighted entry of the top-level switch. Omit to hide the switch. */
  active?: View
  /** Sub-page name, shown after the switch from 640px upwards. */
  title?: string
  /** Turns the gorilla into a back button — the mark for detail pages. */
  back?: { to: string, label: string }
  showLogout?: boolean
}>(), { showLogout: true })

defineEmits<{ logout: [] }>()
</script>

<template>
  <header class="app-header">
    <div class="app-header__nav">
      <UButton v-if="back" :to="back.to" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-left">
        {{ back.label }}
      </UButton>
      <span v-else class="app-header__mark" aria-hidden="true">🦍</span>

      <ViewToggle v-if="active" :active="active" />

      <template v-if="title">
        <span class="app-header__sep">/</span>
        <h1 class="app-header__title">
          {{ title }}
        </h1>
      </template>
    </div>

    <div class="app-header__actions">
      <slot name="actions" />
      <UButton
        v-if="showLogout"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-log-out"
        aria-label="Abmelden"
        @click="$emit('logout')"
      />
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: calc(env(safe-area-inset-top) + 0.75rem) 1rem 0.75rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-zinc-800) 80%, transparent);
  background: color-mix(in srgb, var(--color-zinc-950) 80%, transparent);
  backdrop-filter: saturate(140%) blur(12px);
}

/* min-width: 0 is what keeps a long title from pushing the actions off the
 * screen — without it the flex item refuses to shrink below its content. */
.app-header__nav {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.app-header__mark {
  flex-shrink: 0;
  font-size: 1.5rem;
  line-height: 1;
}

.app-header__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.5rem;
}

/* On a phone the switch alone fills the row, so the sub-page name steps back. */
.app-header__sep,
.app-header__title {
  display: none;
}

@media (min-width: 640px) {
  .app-header {
    padding-left: 2rem;
    padding-right: 2rem;
  }

  .app-header__sep {
    display: inline;
    color: var(--color-zinc-500);
  }

  .app-header__title {
    display: block;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
