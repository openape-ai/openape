<script setup lang="ts">
import { ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { t } = useI18n()
const { user, loading, fetchUser, login } = useOpenApeAuth()
await fetchUser()

if (user.value) {
  await navigateTo('/companies')
}

const email = ref('')
const error = ref('')
const submitting = ref(false)

async function handleLogin() {
  error.value = ''
  if (!email.value || !email.value.includes('@')) {
    error.value = t('index.error.invalidEmail')
    return
  }
  submitting.value = true
  try {
    await login(email.value.trim())
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('index.error.loginFailed')
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md flex flex-col items-center text-center">
        <OpenApeOAuthErrorAlert
          class="text-left mb-6 w-full"
          :messages="{
            access_denied: $t('login.oauth.accessDenied'),
          }"
        />

        <div class="text-6xl mb-6" aria-hidden="true">
          🦍
        </div>

        <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          {{ $t('index.hero.line1') }}<br>
          {{ $t('index.hero.line2') }}<br>
          <span class="text-primary-500">{{ $t('index.hero.line3') }}</span>
        </h1>

        <p class="mt-4 text-zinc-400 text-lg">
          {{ $t('index.hero.subtitle') }}
        </p>

        <form class="mt-10 w-full space-y-3" @submit.prevent="handleLogin">
          <UInput
            v-model="email"
            type="email"
            :placeholder="$t('index.email.placeholder')"
            size="xl"
            autocomplete="email"
            icon="i-lucide-mail"
            :disabled="submitting || loading"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
          <p v-if="error" class="text-sm text-red-400 text-left">
            {{ error }}
          </p>
          <UButton
            type="submit"
            color="primary"
            block
            size="xl"
            icon="i-lucide-fingerprint"
            :loading="submitting || loading"
          >
            {{ $t('index.submit') }}
          </UButton>
        </form>

        <p class="mt-10 italic text-sm text-zinc-500">
          {{ $t('index.tagline') }}
        </p>
      </div>
    </main>

    <footer class="py-6 text-center text-xs text-zinc-600">
      {{ $t('index.footer.poweredBy') }}
      <a
        href="https://openape.ai"
        target="_blank"
        rel="noopener"
        class="text-zinc-400 hover:text-primary-500 transition-colors"
      >OpenApe</a>
    </footer>
  </div>
</template>
