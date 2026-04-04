<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { IdpEnrollConfirm } from '@openape/vue-components'

const route = useRoute()
const router = useRouter()

function handleEnrolled(result: { agentId: string }) {
  router.push(`/?enrolled=${result.agentId}`)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-lg">
      <IdpEnrollConfirm
        :agent-id="route.query.id as string"
        :agent-email="route.query.email as string"
        :agent-name="route.query.name as string"
        :agent-key="route.query.key as string"
        @enrolled="handleEnrolled"
      />
    </div>
  </div>
</template>
