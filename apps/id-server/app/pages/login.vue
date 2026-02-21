<script setup lang="ts">
const { login } = useAuth()
const route = useRoute()

const email = ref((route.query.login_hint as string) ?? '')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function handleSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await login(email.value, password.value)
    const returnTo = route.query.returnTo as string | undefined
    if (returnTo?.startsWith('/')) {
      await navigateTo(returnTo)
    } else if (returnTo) {
      await navigateTo(returnTo, { external: true })
    } else {
      await navigateTo('/')
    }
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-2xl font-bold text-center">Login</h1>
      </template>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mb-4"
      />

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <UFormField label="Email" required>
          <UInput
            id="email"
            v-model="email"
            type="email"
            required
            placeholder="phofmann@office.or.at"
          />
        </UFormField>

        <UFormField label="Password" required>
          <UInput
            id="password"
            v-model="password"
            type="password"
            required
            placeholder="Password"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          block
          :loading="submitting"
          :disabled="submitting"
          :label="submitting ? 'Logging in...' : 'Login'"
        />
      </form>

      <template #footer>
        <div class="text-center">
          <UButton
            to="/"
            variant="link"
            label="Back to Home"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
