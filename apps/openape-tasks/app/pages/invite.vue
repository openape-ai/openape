<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

definePageMeta({ layout: false })

const { user, fetchUser, login } = useOpenApeAuth()
const route = useRoute()
const token = computed(() => String(route.query.t ?? ''))

interface InvitePreview {
  team_id: string
  team_name: string
  team_description: string | null
  inviter_email: string
  note: string | null
  expires_at: number
  uses_remaining: number
}

const preview = ref<InvitePreview | null>(null)
const loading = ref(true)
const accepting = ref(false)
const error = ref('')
const loginEmail = ref('')
const loginSubmitting = ref(false)
const loginError = ref('')

onMounted(async () => {
  await fetchUser()
  if (!token.value) {
    error.value = 'Missing invite token'
    loading.value = false
    return
  }
  await loadPreview()
})

async function loadPreview() {
  loading.value = true
  error.value = ''
  try {
    preview.value = await ($fetch as any)(`/api/invites/${encodeURIComponent(token.value)}`) as InvitePreview
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, statusCode?: number }
    error.value = e.data?.title ?? 'Invite not available'
    preview.value = null
  }
  finally {
    loading.value = false
  }
}

async function onLogin() {
  if (!loginEmail.value.trim() || loginSubmitting.value) return
  loginSubmitting.value = true
  loginError.value = ''
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        'openape-tasks:returnTo',
        `/invite?t=${encodeURIComponent(token.value)}`,
      )
    }
    await login(loginEmail.value.trim())
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    loginError.value = e.data?.title ?? 'Login failed'
  }
  finally {
    loginSubmitting.value = false
  }
}

async function onAccept() {
  if (accepting.value || !preview.value) return
  accepting.value = true
  error.value = ''
  try {
    const result = await ($fetch as any)('/api/invites/accept', {
      method: 'POST',
      body: { token: token.value },
    }) as { team_id: string }
    await navigateTo(`/teams/${result.team_id}`)
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Failed to accept invite'
  }
  finally {
    accepting.value = false
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}
</script>

<template>
  <div class="min-h-dvh py-12 px-4">
    <div class="max-w-md mx-auto">
      <h1 class="text-2xl font-bold mb-6 text-center">
        Team invite
      </h1>

      <div v-if="loading" class="text-center text-gray-500">
        Loading invite…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" />

      <UCard v-else-if="preview">
        <div class="space-y-3">
          <div>
            <div class="text-sm text-gray-500">
              You're invited to join
            </div>
            <div class="text-xl font-semibold">
              {{ preview.team_name }}
            </div>
            <div v-if="preview.team_description" class="text-sm text-gray-500 mt-1">
              {{ preview.team_description }}
            </div>
          </div>

          <div class="text-sm text-gray-500 space-y-1 border-t border-gray-200 dark:border-gray-700 pt-3">
            <div>Invited by <span class="font-mono">{{ preview.inviter_email }}</span></div>
            <div>Expires {{ formatDate(preview.expires_at) }}</div>
            <div>{{ preview.uses_remaining }} use{{ preview.uses_remaining === 1 ? '' : 's' }} remaining</div>
            <div v-if="preview.note" class="italic">
              "{{ preview.note }}"
            </div>
          </div>

          <div v-if="user" class="pt-3">
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Signed in as <span class="font-mono">{{ user.sub }}</span>
            </p>
            <UButton
              color="primary"
              size="lg"
              block
              :loading="accepting"
              @click="onAccept"
            >
              Join team
            </UButton>
          </div>

          <form v-else class="pt-3 space-y-3" @submit.prevent="onLogin">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Sign in to accept this invite.
            </p>
            <UFormField label="Email">
              <UInput
                v-model="loginEmail"
                type="email"
                placeholder="you@example.com"
                class="w-full"
                required
              />
            </UFormField>
            <UAlert v-if="loginError" color="error" :title="loginError" @close="loginError = ''" />
            <UButton
              type="submit"
              color="primary"
              size="lg"
              block
              :loading="loginSubmitting"
              :disabled="!loginEmail.trim() || loginSubmitting"
            >
              Continue
            </UButton>
          </form>
        </div>
      </UCard>
    </div>
  </div>
</template>
