<script setup>
import { DEFAULT_OAUTH_ERROR_MESSAGES } from '../composables/useOpenApeOAuthError'

defineProps({
  title: { type: String, required: false, default: 'Sign in' },
  subtitle: { type: String, required: false, default: 'Enter your email to continue' },
  buttonText: { type: String, required: false, default: 'Continue' },
  placeholder: { type: String, required: false, default: 'you@example.com' },
})
const emit = defineEmits(['error'])
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
  // Surface IdP authorize-deny redirects (RFC 6749 §4.1.2.1) with
  // friendly per-code copy. SPs that want richer UX (UAlert with
  // dismiss-X, product-specific guidance) should drop
  // <OpenApeOAuthErrorAlert /> on the page and skip this form's
  // built-in error display.
  if (typeof route.query.error === 'string' && route.query.error) {
    const code = route.query.error
    error.value = DEFAULT_OAUTH_ERROR_MESSAGES[code] ?? `Login failed: ${code}.`
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
  catch (e) {
    const err = e instanceof Error ? e : new Error('Login failed')
    error.value = e?.data?.message || err.message
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
.openape-auth{--oa-bg:#fff;--oa-border:#e2e2e2;--oa-text:#1a1a1a;--oa-text-muted:#6b7280;--oa-primary:#18181b;--oa-primary-hover:#27272a;--oa-primary-text:#fff;--oa-error:#dc2626;--oa-error-bg:#fef2f2;--oa-input-bg:#fff;--oa-input-border:#d1d5db;--oa-input-focus:#18181b;--oa-radius:8px;--oa-font:system-ui,-apple-system,sans-serif;background:var(--oa-bg);border:1px solid var(--oa-border);border-radius:var(--oa-radius);box-sizing:border-box;color:var(--oa-text);font-family:var(--oa-font);max-width:400px;padding:2rem;width:100%}.openape-auth--loading{align-items:center;display:flex;justify-content:center;min-height:200px}.openape-auth-spinner{animation:oa-spin .6s linear infinite;border:2.5px solid var(--oa-border);border-radius:50%;border-top-color:var(--oa-primary);height:24px;width:24px}.openape-auth-header{margin-bottom:1.5rem;text-align:center}.openape-auth-title{color:var(--oa-text);font-size:1.375rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .375rem}.openape-auth-subtitle{color:var(--oa-text-muted);font-size:.875rem;margin:0}.openape-auth-form{display:flex;flex-direction:column;gap:.75rem}.openape-auth-error{background:var(--oa-error-bg);border-radius:calc(var(--oa-radius) - 2px);color:var(--oa-error);font-size:.8125rem;margin:0;padding:.625rem .75rem}.openape-auth-input{background:var(--oa-input-bg);border:1px solid var(--oa-input-border);border-radius:calc(var(--oa-radius) - 2px);box-sizing:border-box;color:var(--oa-text);font-family:var(--oa-font);font-size:.9375rem;outline:none;padding:.625rem .75rem;transition:border-color .15s;width:100%}.openape-auth-input:focus{border-color:var(--oa-input-focus);box-shadow:0 0 0 1px var(--oa-input-focus)}.openape-auth-input:disabled{cursor:not-allowed;opacity:.6}.openape-auth-button{background:var(--oa-primary);border:none;border-radius:calc(var(--oa-radius) - 2px);color:var(--oa-primary-text);cursor:pointer;font-family:var(--oa-font);font-size:.9375rem;font-weight:500;padding:.625rem 1rem;transition:background .15s}.openape-auth-button:hover:not(:disabled){background:var(--oa-primary-hover)}.openape-auth-button:disabled{cursor:not-allowed;opacity:.5}.openape-auth-button-loading{align-items:center;display:inline-flex;gap:.5rem;justify-content:center}.openape-auth-spinner-icon{animation:oa-spin .6s linear infinite;height:16px;width:16px}@keyframes oa-spin{to{transform:rotate(1turn)}}@media (prefers-color-scheme:dark){.openape-auth{--oa-bg:#18181b;--oa-border:#2e2e32;--oa-text:#f4f4f5;--oa-text-muted:#a1a1aa;--oa-primary:#f4f4f5;--oa-primary-hover:#e4e4e7;--oa-primary-text:#18181b;--oa-error-bg:#2d1215;--oa-input-bg:#1f1f23;--oa-input-border:#3f3f46;--oa-input-focus:#a1a1aa}}
</style>
