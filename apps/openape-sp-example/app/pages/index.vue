<script setup lang="ts">
const { user, loading, fetchUser, login } = useAuth()
const email = ref('')
const error = ref('')
const submitting = ref(false)

const route = useRoute()

onMounted(async () => {
  await fetchUser()
  if (user.value) {
    navigateTo('/dashboard')
  }
  if (route.query.error) {
    error.value = String(route.query.error)
  }
})

async function handleLogin() {
  error.value = ''
  if (!email.value || !email.value.includes('@')) {
    error.value = 'Please enter a valid email address'
    return
  }
  submitting.value = true
  try {
    await login(email.value)
  }
  catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login failed'
    error.value = msg
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="max-w-md w-full space-y-8">
      <UCard>
        <template #header>
          <div class="text-center">
            <h1 class="text-3xl font-bold">
              Sample SP
            </h1>
            <p class="mt-2 text-muted">
              Sign in with your email using DNS-Delegated Identity.
            </p>
          </div>
        </template>

        <div v-if="loading" class="text-center text-muted">
          Loading...
        </div>

        <form v-else class="space-y-6" @submit.prevent="handleLogin">
          <UAlert
            v-if="error"
            color="error"
            :title="error"
          />

          <UFormField label="Email address" required>
            <UInput
              id="email"
              v-model="email"
              type="email"
              placeholder="user@example.com"
              required
            />
          </UFormField>
          <p class="mt-1 text-xs text-muted">
            Uses real DNS resolution to discover the IdP for your domain.
          </p>

          <UButton
            type="submit"
            :loading="submitting"
            :disabled="submitting"
            block
            label="Login with DDISA"
          />
        </form>

        <template #footer>
          <div class="text-center text-xs text-dimmed">
            <p>SP manifest:</p>
            <a href="/.well-known/sp-manifest.json" target="_blank" class="text-(--ui-primary) underline">
              /.well-known/sp-manifest.json
            </a>
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
