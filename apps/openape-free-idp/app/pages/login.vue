<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

useSeoMeta({ title: 'Login' })

const route = useRoute()
const loginHint = (route.query.login_hint as string) || ''

const email = ref(loginHint)
const keyMode = ref(false)

// Challenge-response state
const challenge = ref('')
const signCommand = ref('')
const signature = ref('')
const challengeLoading = ref(false)
const verifyLoading = ref(false)
const challengeError = ref('')
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const { login, error: webauthnError, loading } = useWebAuthn()
const { fetchUser } = useIdpAuth()

async function handlePasskeyLogin() {
  const success = await login(email.value || undefined)
  if (success) {
    await fetchUser()
    const returnTo = route.query.returnTo as string
    if (returnTo) {
      await navigateTo(returnTo, { external: true })
    }
    else {
      await navigateTo('/')
    }
  }
}

async function requestChallenge() {
  challengeError.value = ''
  challenge.value = ''
  signature.value = ''
  if (!email.value) {
    challengeError.value = 'Email is required'
    return
  }

  challengeLoading.value = true
  try {
    const res = await $fetch<{ challenge: string }>('/api/auth/challenge', {
      method: 'POST',
      body: { id: email.value },
    })
    challenge.value = res.challenge
    signCommand.value = `echo -n "${res.challenge}" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n openape`

    // Start 60s countdown
    countdown.value = 60
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        clearInterval(countdownTimer!)
        countdownTimer = null
        challenge.value = ''
        challengeError.value = 'Challenge expired. Request a new one.'
      }
    }, 1000)
  }
  catch (err: unknown) {
    const msg = (err as { data?: { title?: string } })?.data?.title
    challengeError.value = msg || 'Failed to get challenge. Check your email.'
  }
  finally {
    challengeLoading.value = false
  }
}

async function submitSignature() {
  challengeError.value = ''
  if (!signature.value.trim()) {
    challengeError.value = 'Paste the signature output'
    return
  }

  verifyLoading.value = true
  try {
    await $fetch('/api/session/login', {
      method: 'POST',
      body: {
        id: email.value,
        challenge: challenge.value,
        signature: signature.value.trim(),
      },
    })
    await fetchUser()
    const returnTo = route.query.returnTo as string
    if (returnTo) {
      await navigateTo(returnTo, { external: true })
    }
    else {
      await navigateTo('/')
    }
  }
  catch (err: unknown) {
    const msg = (err as { data?: { title?: string } })?.data?.title
    challengeError.value = msg || 'Authentication failed. Check your signature.'
  }
  finally {
    verifyLoading.value = false
  }
}

function resetChallenge() {
  challenge.value = ''
  signature.value = ''
  challengeError.value = ''
  countdown.value = 0
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function copyCommand() {
  navigator.clipboard.writeText(signCommand.value)
}

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md flex flex-col items-center text-center">
      <div class="text-6xl mb-6">
        🦍
      </div>

      <h1 class="text-4xl sm:text-5xl font-extrabold text-white mb-4">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="text-lg text-gray-400 mb-8">
        Passwordless authentication for the open web.
      </p>

      <!-- Passkey mode (default) -->
      <form v-if="!keyMode" class="w-full space-y-4" @submit.prevent="handlePasskeyLogin">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com (optional)"
          icon="i-lucide-mail"
          size="xl"
          class="w-full"
        />

        <UButton
          type="submit"
          color="primary"
          size="xl"
          block
          :loading="loading"
          icon="i-lucide-fingerprint"
        >
          Sign in with Passkey
        </UButton>
      </form>

      <!-- SSH Key challenge-response mode -->
      <div v-else class="w-full space-y-4">
        <!-- Step 1: Email + Get Challenge -->
        <div v-if="!challenge" class="space-y-4">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            icon="i-lucide-mail"
            size="xl"
            class="w-full"
            @keydown.enter="requestChallenge"
          />

          <UButton
            color="primary"
            size="xl"
            block
            :loading="challengeLoading"
            :disabled="!email || challengeLoading"
            icon="i-lucide-key-round"
            @click="requestChallenge"
          >
            Get Challenge
          </UButton>
        </div>

        <!-- Step 2: Sign + Submit -->
        <div v-else class="space-y-4 text-left">
          <div class="text-sm text-gray-400">
            Sign this challenge with your private key <span class="text-gray-500">({{ countdown }}s)</span>
          </div>

          <div class="relative">
            <pre class="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-green-400 font-mono whitespace-pre-wrap break-all overflow-x-auto">{{ signCommand }}</pre>
            <button
              class="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
              title="Copy to clipboard"
              @click="copyCommand"
            >
              <UIcon name="i-lucide-copy" class="w-4 h-4" />
            </button>
          </div>

          <div class="text-xs text-gray-500">
            Your key never leaves your machine.
          </div>

          <UTextarea
            v-model="signature"
            placeholder="Paste the signature output here..."
            :rows="5"
            class="w-full font-mono text-xs"
          />

          <div class="flex gap-2">
            <UButton
              color="primary"
              size="xl"
              class="flex-1"
              :loading="verifyLoading"
              :disabled="!signature.trim() || verifyLoading"
              icon="i-lucide-log-in"
              @click="submitSignature"
            >
              Sign In
            </UButton>
            <UButton
              variant="ghost"
              size="xl"
              icon="i-lucide-rotate-ccw"
              @click="resetChallenge"
            />
          </div>
        </div>
      </div>

      <p v-if="webauthnError || challengeError" class="mt-3 text-sm text-red-400 text-center">
        {{ webauthnError || challengeError }}
      </p>

      <button
        class="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
        @click="keyMode = !keyMode; resetChallenge()"
      >
        {{ keyMode ? 'Sign in with Passkey instead' : 'Sign in with SSH Key instead' }}
      </button>

      <div class="mt-6 text-sm text-gray-500">
        Noch keinen Account?
        <NuxtLink to="/register-email" class="text-primary hover:underline">
          Jetzt registrieren
        </NuxtLink>
      </div>

      <p class="mt-8 text-sm text-gray-500">
        Powered by <NuxtLink to="https://openape.at" external class="text-gray-400 hover:text-white transition-colors">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
