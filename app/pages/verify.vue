<script setup lang="ts">
import { useRoute } from '#imports'

const route = useRoute()
const success = route.query.success === 'true'
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <UCard class="w-full max-w-md bg-gray-900 border border-gray-800">
      <div class="text-center py-4">
        <template v-if="success">
          <UIcon name="i-lucide-check-circle" class="text-4xl text-green-500 mb-3" />
          <h2 class="text-lg font-semibold text-white mb-2">
            Verifizierung erfolgreich
          </h2>
          <p class="text-sm text-gray-400">
            Deine Email wurde verifiziert. Du wirst weitergeleitet.
          </p>
        </template>
        <template v-else>
          <UIcon name="i-lucide-mail-search" class="text-4xl text-primary mb-3" />
          <h2 class="text-lg font-semibold text-white mb-2">
            Prüfe dein Postfach
          </h2>
          <p class="text-sm text-gray-400">
            Klicke auf den Link in der Email um dich anzumelden.
          </p>
        </template>
      </div>
    </UCard>
  </div>
</template>
