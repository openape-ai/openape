<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { IdpGrantApproval } from '@openape/vue-components'

const route = useRoute()
const router = useRouter()
const grantId = route.query.grant_id as string
const callback = route.query.callback as string

function handleDone(result: { status: string, authzJwt?: string }) {
  if (callback) {
    const url = new URL(callback)
    url.searchParams.set('grant_id', grantId)
    url.searchParams.set('status', result.status)
    if (result.authzJwt) {
      url.searchParams.set('authz_jwt', result.authzJwt)
    }
    window.location.href = url.toString()
  }
  else {
    router.push('/')
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-lg">
      <IdpGrantApproval
        :grant-id="grantId"
        @done="handleDone"
      />
    </div>
  </div>
</template>
