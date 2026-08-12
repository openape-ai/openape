<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { renderSVG } from 'uqr'

// The kiosk half of QR sign-in: mint a channel, show its id as a QR, poll
// for the claim until the phone approves. The claimSecret stays in this
// component and never appears in the QR or the DOM.

const emit = defineEmits<{ signedIn: [] }>()

const qr = ref('')
const error = ref('')
const expired = ref(false)
const loading = ref(false)

let channelId = ''
let claimSecret = ''
let pollTimer: ReturnType<typeof setInterval> | undefined
let expireTimer: ReturnType<typeof setTimeout> | undefined

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  if (expireTimer) clearTimeout(expireTimer)
  pollTimer = undefined
  expireTimer = undefined
}

onBeforeUnmount(stopPolling)

async function start() {
  error.value = ''
  expired.value = false
  loading.value = true
  try {
    const res = await $fetch<{ channelId: string, claimSecret: string, expiresIn: number }>(
      '/api/session/qr',
      { method: 'POST' },
    )
    channelId = res.channelId
    claimSecret = res.claimSecret
    // Light-on-dark inverts on a camera; QR readers expect dark on light.
    const url = `${window.location.origin}/link?c=${channelId}`
    qr.value = renderSVG(url, { blackColor: '#000', whiteColor: '#fff', border: 2 })
    pollTimer = setInterval(poll, 2000)
    expireTimer = setTimeout(() => {
      stopPolling()
      qr.value = ''
      expired.value = true
    }, res.expiresIn * 1000)
  }
  catch (err: any) {
    error.value = err?.data?.title ?? 'Could not start QR sign-in'
  }
  finally {
    loading.value = false
  }
}

async function poll() {
  try {
    const res = await $fetch<{ status: 'pending' | 'ok' }>(
      `/api/session/qr/${channelId}/claim`,
      { method: 'POST', body: { claimSecret } },
    )
    if (res.status === 'ok') {
      stopPolling()
      emit('signedIn')
    }
  }
  catch {
    // The channel died (expired or denied) — offer a fresh code.
    stopPolling()
    qr.value = ''
    expired.value = true
  }
}
</script>

<template>
  <div class="qr-login">
    <UAlert v-if="error" color="error" :title="error" class="mb-2" />

    <div v-if="qr">
      <!-- eslint-disable-next-line vue/no-v-html -- our own encoder's output, no user input -->
      <div class="qr" v-html="qr" />
      <p class="text-xs text-muted mt-2">
        Scan with the phone you are signed in on, then approve there. Works once, within 2 minutes.
      </p>
    </div>

    <template v-else>
      <UAlert
        v-if="expired"
        color="warning"
        title="The code expired"
        class="mb-2"
      />
      <UButton
        block
        variant="outline"
        :loading="loading"
        :label="expired ? 'New code' : 'Sign in with phone'"
        @click="start"
      />
    </template>
  </div>
</template>

<style scoped>
/* Geometry lives here, not in utility classes: this component ships inside
   the module, and a consuming app's Tailwind only generates the utilities it
   finds in its own sources. */
.qr {
  width: 10rem;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 0.5rem;
}

/* uqr emits a viewBox-only svg, which would otherwise render at its
   intrinsic 300px and spill out of the card. */
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
