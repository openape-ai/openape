<script setup lang="ts">
defineProps<{ gate?: { blockers: string[] } | null, mergeable: boolean, conflicts: string[], canMerge: boolean, busy: boolean }>()
const emit = defineEmits<{ merge: [] }>()
</script>

<template>
  <section class="border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
    <p v-if="gate?.blockers.length" class="text-amber-400 text-sm">
      Required checks: {{ gate.blockers.join('; ') }}
    </p>
    <template v-if="mergeable">
      <UIcon name="i-lucide-check-circle-2" class="size-4 text-emerald-500" />
      <span class="text-sm">This branch merges cleanly.</span>
    </template>
    <template v-else>
      <UIcon name="i-lucide-x-circle" class="size-4 text-red-500" />
      <span class="text-sm">
        Conflicts<template v-if="conflicts.length"> in
          <code class="font-mono">{{ conflicts.join(', ') }}</code></template>.
      </span>
    </template>
    <UButton
      v-if="canMerge"
      class="ml-auto"
      size="sm"
      icon="i-lucide-git-merge"
      :color="mergeable ? 'primary' : 'neutral'"
      :disabled="!mergeable"
      :loading="busy"
      @click="emit('merge')"
    >
      Merge pull request
    </UButton>
  </section>
</template>
