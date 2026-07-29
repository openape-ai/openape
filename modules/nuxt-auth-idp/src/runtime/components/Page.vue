<script setup lang="ts">
// The page scaffold for the module's signed-in pages: one content column,
// one title treatment, one back link. Host apps frame this with their own
// layout (background, identity bar); this owns everything inside it.

defineProps<{
  title: string
  subtitle?: string
  backTo?: string
  backLabel?: string
}>()
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
    <div class="mb-8">
      <UButton
        v-if="backTo"
        :to="backTo"
        color="neutral"
        variant="link"
        size="sm"
        icon="i-lucide-arrow-left"
        class="-ml-2 mb-2"
      >
        {{ backLabel ?? 'Back' }}
      </UButton>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight">
            {{ title }}
          </h1>
          <p v-if="subtitle" class="mt-1 text-sm text-muted">
            {{ subtitle }}
          </p>
        </div>
        <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </div>

    <slot />
  </div>
</template>
