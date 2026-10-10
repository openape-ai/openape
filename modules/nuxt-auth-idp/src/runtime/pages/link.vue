<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { navigateTo, useHead, useRoute } from '#imports'

// The phone half of QR sign-in: scanned from the kiosk's screen. Shows who
// is asking before anything happens — this context (and the human reading
// it) is the only defense against a relayed code (QRLjacking).

useHead({ title: 'Approve sign-in' })

const route = useRoute()
const channelId = typeof route.query.c === 'string' ? route.query.c : ''

interface ChannelContext {
  state: 'pending' | 'approved'
  requester: { ip: string, userAgent: string }
  expiresAt: number
}

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const context = ref<ChannelContext | null>(null)
const outcome = ref<'approved' | 'denied' | ''>('')

onMounted(async () => {
  if (!channelId) {
    error.value = 'This link is missing its sign-in code.'
    loading.value = false
    return
  }
  try {
    context.value = await $fetch<ChannelContext>(`/api/session/qr/${channelId}`)
  }
  catch (err: any) {
    const status = err?.statusCode ?? err?.status
    if (status === 401) {
      // Not signed in on this phone yet — passkey first, then back here.
      await navigateTo(`/login?returnTo=${encodeURIComponent(`/link?c=${channelId}`)}`)
      return
    }
    error.value = err?.data?.title ?? 'Sign-in code expired or unknown'
  }
  finally {
    loading.value = false
  }
})

async function respond(action: 'approve' | 'deny') {
  busy.value = true
  error.value = ''
  try {
    await $fetch(`/api/session/qr/${channelId}/${action}`, { method: 'POST' })
    outcome.value = action === 'approve' ? 'approved' : 'denied'
  }
  catch (err: any) {
    error.value = err?.data?.title ?? 'Could not answer the sign-in request'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">
          Approve sign-in?
        </h1>
      </template>

      <div v-if="loading" class="text-center text-muted">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <div v-else-if="outcome === 'approved'" class="text-center space-y-2">
        <UIcon name="i-lucide-check-circle" class="size-8 text-success" />
        <p>The other browser is now signed in as you.</p>
        <p class="text-xs text-muted">
          It stays signed in for one hour. You can end it early under Account &amp; security.
        </p>
      </div>

      <div v-else-if="outcome === 'denied'" class="text-center space-y-2">
        <UIcon name="i-lucide-shield-x" class="size-8" />
        <p>Sign-in request denied.</p>
      </div>

      <div v-else-if="context" class="space-y-4">
        <p>A browser wants to sign in <strong>as you</strong>:</p>
        <ul class="text-sm space-y-1">
          <li><span class="text-muted">IP address:</span> {{ context.requester.ip }}</li>
          <li><span class="text-muted">Browser:</span> {{ context.requester.userAgent }}</li>
        </ul>
        <UAlert
          color="warning"
          title="Only approve if this code is on a screen directly in front of you."
          description="If someone sent you this code, it is an attempt to take over your account — deny it."
        />
        <div class="flex gap-2">
          <UButton
            color="primary"
            block
            :loading="busy"
            label="Approve"
            @click="respond('approve')"
          />
          <UButton
            color="neutral"
            variant="outline"
            block
            :disabled="busy"
            label="Deny"
            @click="respond('deny')"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
