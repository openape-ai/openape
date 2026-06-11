<script setup>
import { onMounted } from 'vue'
import { navigateTo, useHead } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'

// /account — a thin overview hub. The actual management lives on focused
// pages (one per concern) so the dashboard's named buttons land on exactly
// what they say. This page just indexes them (and catches old /account links).

useHead({ title: 'Account & security — OpenApe' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()

const sections = [
  { to: '/passkeys', icon: 'i-lucide-key-round', title: 'Passkeys', desc: 'Add or remove the devices you sign in with.' },
  { to: '/ssh-keys', icon: 'i-lucide-terminal', title: 'SSH Keys', desc: 'Public keys for "Sign in with SSH Key".' },
  { to: '/connected-services', icon: 'i-lucide-link', title: 'Connected Services', desc: 'Apps you approved at sign-in.' },
  { to: '/delegations', icon: 'i-lucide-shield-check', title: 'Delegations', desc: 'Apps acting on your behalf at another service.' },
]

onMounted(async () => {
  await fetchUser()
  if (!user.value) await navigateTo('/login')
})
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Account &amp; security
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/" color="neutral" variant="soft" size="sm">
          Dashboard
        </UButton>
      </div>

      <div v-if="authLoading" class="text-center text-muted mt-10">
        Loading...
      </div>

      <ul v-else class="space-y-3">
        <li v-for="s in sections" :key="s.to">
          <UButton :to="s.to" color="neutral" variant="soft" block class="justify-start" size="lg">
            <UIcon :name="s.icon" class="size-5 shrink-0" />
            <span class="text-left">
              <span class="block font-medium">{{ s.title }}</span>
              <span class="block text-xs text-muted">{{ s.desc }}</span>
            </span>
          </UButton>
        </li>
      </ul>
    </div>
  </div>
</template>
