<script setup lang="ts">
import { ref } from 'vue'
import { renderSVG } from 'uqr'

// Sits on the account hub because it belongs to "how you sign in", and the
// browser that generates the link is by definition the one already signed in.

const url = ref('')
const qr = ref('')
const error = ref('')
const loading = ref(false)
const copied = ref(false)

async function createLink() {
  error.value = ''
  copied.value = false
  loading.value = true
  try {
    const res = await $fetch<{ url: string }>('/api/session/transfer', { method: 'POST' })
    url.value = res.url
    // Light-on-dark inverts on a camera; QR readers expect dark on light.
    qr.value = renderSVG(res.url, { blackColor: '#000', whiteColor: '#fff', border: 2 })
  }
  catch (err: any) {
    error.value = err?.data?.title ?? 'Could not create a sign-in link'
  }
  finally {
    loading.value = false
  }
}

async function copyLink() {
  await navigator.clipboard.writeText(url.value)
  copied.value = true
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-lg font-semibold">
        Sign in on another browser
      </h2>
      <p class="text-sm text-muted mt-1">
        Create a link for a browser that cannot use passkeys — paste it there, or scan the code with a phone. It signs you in as the same user.
      </p>
    </template>

    <UAlert v-if="error" color="error" :title="error" class="mb-4" />

    <div v-if="url" class="transfer">
      <!-- eslint-disable-next-line vue/no-v-html -- our own encoder's output, no user input -->
      <div class="qr" v-html="qr" />
      <div class="details space-y-2">
        <UInput :model-value="url" readonly class="font-mono text-xs w-full" />
        <UButton color="primary" variant="soft" icon="i-lucide-copy" @click="copyLink">
          {{ copied ? 'Copied' : 'Copy link' }}
        </UButton>
        <p class="text-xs text-muted">
          Works once, within 60 seconds.
        </p>
      </div>
    </div>

    <UButton v-else color="primary" :loading="loading" @click="createLink">
      Create sign-in link
    </UButton>
  </UCard>
</template>

<style scoped>
/* Geometry lives here, not in utility classes: this component ships inside the
   module, and a consuming app's Tailwind only generates the utilities it finds
   in its own sources — `size-40` silently did nothing there. */
.transfer {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 1rem;
}

.details {
  flex: 1;
  min-width: 15rem;
}

.qr {
  width: 10rem;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 0.5rem;
}

/* uqr emits a viewBox-only svg, which would otherwise render at its intrinsic
   300px and spill out of the tile. */
.qr :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
