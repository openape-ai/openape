<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { onMounted, ref } from 'vue'
import { apiFetch } from '../utils/api'

definePageMeta({ layout: false })

const route = useRoute()
const { user, fetchUser } = useOpenApeAuth()
const status = ref<'checking' | 'need-login' | 'error'>('checking')
const error = ref('')

onMounted(async () => {
  const token = String(route.query.token ?? '')
  if (!token) {
    status.value = 'error'
    error.value = 'Dieser Einladungslink ist unvollständig.'
    return
  }

  await fetchUser()
  if (!user.value) {
    // Nach dem Login bringt uns index.vue wieder hierher zurück.
    window.sessionStorage.setItem('openape-crm:returnTo', `/invite?token=${encodeURIComponent(token)}`)
    status.value = 'need-login'
    return
  }

  try {
    const accepted = await apiFetch<{ workspace_id: string }>('/api/invites/accept', {
      method: 'POST',
      body: { token },
    })
    window.localStorage.setItem('openape-crm:workspace', accepted.workspace_id)
    await navigateTo('/board', { replace: true })
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, message?: string }
    status.value = 'error'
    error.value = e.data?.title ?? e.message ?? 'Einladung konnte nicht eingelöst werden'
  }
})
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center bg-zinc-950 px-4 text-zinc-100">
    <UCard class="w-full max-w-md text-center">
      <p v-if="status === 'checking'">
        Einladung wird geprüft …
      </p>
      <template v-else-if="status === 'need-login'">
        <p>Melde dich an, um der Einladung zu folgen.</p>
        <UButton class="mt-4" to="/">
          Zum Login
        </UButton>
      </template>
      <UAlert v-else color="error" :title="error" />
    </UCard>
  </div>
</template>
