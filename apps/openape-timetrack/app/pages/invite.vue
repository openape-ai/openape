<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

definePageMeta({ layout: false })

const { user, fetchUser, login } = useOpenApeAuth()
const route = useRoute()
const token = computed(() => String(route.query.t ?? ''))

interface InvitePreview {
  scope: 'company' | 'project'
  resource_name: string
  role: string
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
  if (!token.value) { error.value = 'Missing invite token'; loading.value = false; return }
  await loadPreview()
})

async function loadPreview() {
  loading.value = true
  error.value = ''
  try {
    preview.value = await ($fetch as any)(`/api/invites/${encodeURIComponent(token.value)}`) as InvitePreview
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Invite not available'
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
        'openape-timetrack:returnTo',
        `/invite?t=${encodeURIComponent(token.value)}`,
      )
    }
    await login(loginEmail.value.trim())
  }
  catch (err: unknown) {
    loginError.value = (err as { data?: { title?: string } }).data?.title ?? 'Login failed'
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
    const r = await ($fetch as any)('/api/invites/accept', {
      method: 'POST',
      body: { token: token.value },
    }) as { scope: string, company_id?: string, project_id?: string }
    await navigateTo(r.scope === 'company' ? `/companies/${r.company_id}` : `/projects/${r.project_id}`)
  }
  catch (err: unknown) {
    error.value = (err as { data?: { title?: string } }).data?.title ?? 'Failed to accept invite'
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
  <div class="min-h-dvh bg-zinc-950 text-zinc-100 py-12 px-4">
    <div class="max-w-md mx-auto">
      <h1 class="text-2xl font-bold mb-6 text-center">
        Invite
      </h1>

      <div v-if="loading" class="text-center text-zinc-500">
        Loading invite…
      </div>
      <UAlert v-else-if="error" color="error" :title="error" />
      <UCard v-else-if="preview">
        <div class="space-y-3">
          <div>
            <div class="text-sm text-zinc-500">
              You're invited to {{ preview.scope }}
            </div>
            <div class="text-xl font-semibold">
              {{ preview.resource_name }}
            </div>
            <div class="text-sm text-zinc-500 mt-1">
              as <span class="font-semibold">{{ preview.role }}</span>
            </div>
          </div>

          <div class="text-sm text-zinc-500 space-y-1 border-t border-zinc-800 pt-3">
            <div>Invited by <span class="font-mono">{{ preview.inviter_email }}</span></div>
            <div>Expires {{ formatDate(preview.expires_at) }}</div>
            <div>{{ preview.uses_remaining }} use{{ preview.uses_remaining === 1 ? '' : 's' }} remaining</div>
            <div v-if="preview.note" class="italic">
              "{{ preview.note }}"
            </div>
          </div>

          <div v-if="user" class="pt-3">
            <p class="text-sm text-zinc-400 mb-2">
              Signed in as <span class="font-mono">{{ user.sub }}</span>
            </p>
            <UButton color="primary" size="lg" block :loading="accepting" @click="onAccept">
              Accept invite
            </UButton>
          </div>

          <form v-else class="pt-3 space-y-3" @submit.prevent="onLogin">
            <p class="text-sm text-zinc-400">
              Sign in to accept this invite.
            </p>
            <UInput v-model="loginEmail" type="email" placeholder="you@example.com" class="w-full" required />
            <UAlert v-if="loginError" color="error" :title="loginError" @close="loginError = ''" />
            <UButton
              type="submit" color="primary" size="lg" block
              :loading="loginSubmitting" :disabled="!loginEmail.trim() || loginSubmitting"
            >
              Continue
            </UButton>
          </form>
        </div>
      </UCard>
    </div>
  </div>
</template>
