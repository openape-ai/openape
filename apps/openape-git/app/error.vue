<script setup lang="ts">
import type { NuxtError } from '#app'
import { clearError } from '#imports'
import { computed } from 'vue'
import { errorCopy } from '~/utils/error-copy'

const props = defineProps<{ error: NuxtError }>()

const status = computed(() => props.error?.statusCode ?? 500)
const copy = computed(() => errorCopy(status.value))
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md flex flex-col items-center text-center">
        <div class="text-6xl mb-6" aria-hidden="true">
          🦍
        </div>

        <p class="text-sm font-mono text-zinc-500">
          {{ status }}
        </p>

        <h1 class="mt-2 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          {{ copy.title }}
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          {{ copy.detail }}
        </p>

        <UButton class="mt-10" color="primary" size="xl" @click="clearError({ redirect: '/' })">
          Back to ape-git
        </UButton>
      </div>
    </main>
  </div>
</template>
