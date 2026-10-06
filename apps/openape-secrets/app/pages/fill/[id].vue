<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useOpenApeAuth, useRoute } from '#imports'
import { seal } from '~/utils/seal'

interface RequestView {
  id: string
  requester: string
  field_name: string
  purpose: string
  status: string
  expires_at: number
  consumer_name: string | null
  consumer_public_key_jwk: JsonWebKey | null
}

const route = useRoute()
const { user, fetchUser } = useOpenApeAuth()
const request = ref<RequestView | null>(null)
const loading = ref(true)
const error = ref('')
const value = ref('')
const busy = ref(false)
const done = ref<'filled' | 'cancelled' | null>(null)

const id = computed(() => String(route.params.id ?? ''))
const open = computed(() => request.value?.status === 'requested')

async function load() {
  loading.value = true
  error.value = ''
  try {
    request.value = await $fetch<RequestView>(`/api/requests/${id.value}`)
  }
  catch (err) {
    const e = err as { data?: { title?: string }, message?: string }
    error.value = e.data?.title ?? e.message ?? 'Could not load this request'
  }
  finally {
    loading.value = false
  }
}

async function submit() {
  const key = request.value?.consumer_public_key_jwk
  if (!key || !value.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Sealed HERE, in this browser. What leaves the device is four base64
    // strings; the plaintext never touches the network or the service.
    const box = await seal(key, value.value)
    await $fetch(`/api/requests/${id.value}/fill`, { method: 'POST', body: { box } })
    // Drop it from memory as soon as it is out of our hands. Not a strong
    // guarantee — the browser may keep copies — but leaving it bound to a live
    // component for the rest of the session is a choice, and a poor one.
    value.value = ''
    done.value = 'filled'
  }
  catch (err) {
    const e = err as { data?: { title?: string }, message?: string }
    error.value = e.data?.title ?? e.message ?? 'Could not hand over the value'
  }
  finally {
    busy.value = false
  }
}

async function decline() {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/requests/${id.value}/cancel`, { method: 'POST' })
    done.value = 'cancelled'
  }
  catch (err) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Could not decline'
  }
  finally {
    busy.value = false
  }
}

onMounted(async () => {
  await fetchUser()
  if (user.value) await load()
  else loading.value = false
})
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 flex items-start justify-center p-4 sm:p-6">
    <div class="w-full max-w-md space-y-4 pt-8">
      <div class="flex items-center gap-2">
        <span class="text-xl" aria-hidden="true">🔑</span>
        <h1 class="text-lg font-semibold tracking-tight">
          A machine needs a secret
        </h1>
      </div>

      <div v-if="loading" class="text-sm text-zinc-500">
        Loading…
      </div>

      <!-- The shared login card from nuxt-auth-sp rather than a hand-rolled
           button: this page is opened from a link, often on a phone, and the
           sign-in step has to look like every other OpenApe sign-in. -->
      <OpenApeAuth
        v-else-if="!user"
        subtitle="Sign in to see what is being asked for."
      />

      <UAlert v-else-if="done === 'filled'" color="success" title="Handed over">
        <template #description>
          The value is sealed for {{ request?.consumer_name }} and can be collected once.
          Nobody else can read it — not this service, and not whoever asked.
        </template>
      </UAlert>

      <UAlert v-else-if="done === 'cancelled'" color="neutral" title="Declined">
        <template #description>
          Nothing was stored. The request is closed.
        </template>
      </UAlert>

      <UAlert v-else-if="error && !request" color="error" :title="error" />

      <template v-else-if="request">
        <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3 text-sm">
          <div>
            <div class="text-xs text-zinc-500">
              Asked by
            </div>
            <div class="font-medium break-all">
              {{ request.requester }}
            </div>
          </div>
          <div v-if="request.purpose">
            <div class="text-xs text-zinc-500">
              Why
            </div>
            <div>{{ request.purpose }}</div>
          </div>
          <div>
            <div class="text-xs text-zinc-500">
              Goes to
            </div>
            <div>{{ request.consumer_name }}</div>
          </div>
          <div>
            <div class="text-xs text-zinc-500">
              Field
            </div>
            <div class="font-mono text-xs break-all">
              {{ request.field_name }}
            </div>
          </div>
        </div>

        <UAlert v-if="!open" color="warning" :title="`This request is ${request.status}`" />

        <template v-else>
          <UInput
            v-model="value"
            type="password"
            :placeholder="request.field_name"
            size="lg"
            class="w-full font-mono"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <p class="text-xs text-zinc-500">
            The value is encrypted in this browser for {{ request.consumer_name }} before it is sent.
            This service stores an envelope it cannot open.
          </p>

          <UAlert v-if="error" color="error" variant="subtle" :title="error" />

          <div class="flex gap-2">
            <UButton color="neutral" variant="soft" class="flex-1" :disabled="busy" @click="decline">
              Decline
            </UButton>
            <UButton color="primary" class="flex-1" :loading="busy" :disabled="!value" @click="submit">
              Hand over
            </UButton>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
