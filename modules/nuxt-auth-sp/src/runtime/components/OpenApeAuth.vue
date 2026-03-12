<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  buttonText?: string
  placeholder?: string
}>(), {
  title: 'Sign in',
  subtitle: 'Enter your email to continue',
  buttonText: 'Continue',
  placeholder: 'you@example.com',
})

const emit = defineEmits<{
  error: [error: Error]
}>()

const { user, loading, fetchUser, login } = useOpenApeAuth()
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

async function handleSubmit() {
  error.value = ''
  if (!email.value || !email.value.includes('@')) {
    error.value = 'Please enter a valid email address'
    return
  }
  submitting.value = true
  try {
    await login(email.value)
  }
  catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Login failed')
    error.value = (e as any)?.data?.message || err.message
    emit('error', err)
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="openape-auth openape-auth--loading">
    <div class="openape-auth-spinner" />
  </div>

  <div v-else class="openape-auth">
    <slot name="header">
      <div class="openape-auth-header">
        <h2 class="openape-auth-title">
          {{ title }}
        </h2>
        <p class="openape-auth-subtitle">
          {{ subtitle }}
        </p>
      </div>
    </slot>

    <form class="openape-auth-form" @submit.prevent="handleSubmit">
      <slot name="error" :error="error">
        <p v-if="error" class="openape-auth-error">
          {{ error }}
        </p>
      </slot>

      <input
        v-model="email"
        type="email"
        class="openape-auth-input"
        :placeholder="placeholder"
        required
        :disabled="submitting"
        autocomplete="email"
      >

      <slot name="button" :submitting="submitting">
        <button
          type="submit"
          class="openape-auth-button"
          :disabled="submitting || !email"
        >
          <span v-if="submitting" class="openape-auth-button-loading">
            <svg class="openape-auth-spinner-icon" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
            </svg>
            Redirecting…
          </span>
          <span v-else>{{ buttonText }}</span>
        </button>
      </slot>
    </form>

    <slot name="footer" />
  </div>
</template>

<style>
.openape-auth {
  --oa-bg: #ffffff;
  --oa-border: #e2e2e2;
  --oa-text: #1a1a1a;
  --oa-text-muted: #6b7280;
  --oa-primary: #18181b;
  --oa-primary-hover: #27272a;
  --oa-primary-text: #ffffff;
  --oa-error: #dc2626;
  --oa-error-bg: #fef2f2;
  --oa-input-bg: #ffffff;
  --oa-input-border: #d1d5db;
  --oa-input-focus: #18181b;
  --oa-radius: 8px;
  --oa-font: system-ui, -apple-system, sans-serif;

  font-family: var(--oa-font);
  background: var(--oa-bg);
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  padding: 2rem;
  width: 100%;
  max-width: 400px;
  box-sizing: border-box;
  color: var(--oa-text);
}

.openape-auth--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.openape-auth-spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid var(--oa-border);
  border-top-color: var(--oa-primary);
  border-radius: 50%;
  animation: oa-spin 0.6s linear infinite;
}

.openape-auth-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.openape-auth-title {
  font-size: 1.375rem;
  font-weight: 600;
  margin: 0 0 0.375rem;
  letter-spacing: -0.01em;
  color: var(--oa-text);
}

.openape-auth-subtitle {
  font-size: 0.875rem;
  color: var(--oa-text-muted);
  margin: 0;
}

.openape-auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.openape-auth-error {
  font-size: 0.8125rem;
  color: var(--oa-error);
  background: var(--oa-error-bg);
  border-radius: calc(var(--oa-radius) - 2px);
  padding: 0.625rem 0.75rem;
  margin: 0;
}

.openape-auth-input {
  font-family: var(--oa-font);
  font-size: 0.9375rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--oa-input-border);
  border-radius: calc(var(--oa-radius) - 2px);
  background: var(--oa-input-bg);
  color: var(--oa-text);
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}

.openape-auth-input:focus {
  border-color: var(--oa-input-focus);
  box-shadow: 0 0 0 1px var(--oa-input-focus);
}

.openape-auth-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.openape-auth-button {
  font-family: var(--oa-font);
  font-size: 0.9375rem;
  font-weight: 500;
  padding: 0.625rem 1rem;
  border: none;
  border-radius: calc(var(--oa-radius) - 2px);
  background: var(--oa-primary);
  color: var(--oa-primary-text);
  cursor: pointer;
  transition: background 0.15s;
}

.openape-auth-button:hover:not(:disabled) {
  background: var(--oa-primary-hover);
}

.openape-auth-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.openape-auth-button-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
}

.openape-auth-spinner-icon {
  width: 16px;
  height: 16px;
  animation: oa-spin 0.6s linear infinite;
}

@keyframes oa-spin {
  to { transform: rotate(360deg); }
}

/* Dark mode support via prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  .openape-auth {
    --oa-bg: #18181b;
    --oa-border: #2e2e32;
    --oa-text: #f4f4f5;
    --oa-text-muted: #a1a1aa;
    --oa-primary: #f4f4f5;
    --oa-primary-hover: #e4e4e7;
    --oa-primary-text: #18181b;
    --oa-error-bg: #2d1215;
    --oa-input-bg: #1f1f23;
    --oa-input-border: #3f3f46;
    --oa-input-focus: #a1a1aa;
  }
}
</style>
