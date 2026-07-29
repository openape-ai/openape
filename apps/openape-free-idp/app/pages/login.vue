<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

useSeoMeta({ title: 'Login' })

const route = useRoute()
const loginHint = (route.query.login_hint as string) || ''

const email = ref(loginHint)
const keyMode = ref(false)

// With a pre-filled email (login_hint) the user just needs to confirm — focus the
// passkey button so Enter authenticates; otherwise focus the email field to type.
const emailInput = ref<{ $el?: HTMLElement } | null>(null)
const passkeyBtn = ref<{ $el?: HTMLElement } | null>(null)
onMounted(() => {
  const target = loginHint
    ? (passkeyBtn.value?.$el as HTMLElement | undefined)
    : emailInput.value?.$el?.querySelector<HTMLElement>('input')
  target?.focus()
})

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

const noPasskeyForDomain = computed(() =>
  /no passkeys?/i.test(webauthnError.value ?? ''),
)

async function handlePasskeyLogin() {
  try {
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
  catch {
    // Composable already populated webauthnError; the template offers the
    // re-register CTA when the message indicates "no passkeys for this domain"
    // (typical after a passkey loss or RP-domain migration like .at → .ai).
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

    // Start 5min countdown (matches server-side challenge TTL)
    countdown.value = 300
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
  <IdpHero>
    <div class="flex flex-col items-center text-center">
      <div class="mb-6 text-6xl">
        🦍
      </div>

      <h1 class="mb-4 text-4xl font-extrabold sm:text-5xl">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="mb-8 text-lg text-muted">
        Passwordless authentication for the open web.
      </p>

      <!-- Passkey mode (default) -->
      <form v-if="!keyMode" class="w-full space-y-4" @submit.prevent="handlePasskeyLogin">
        <UInput
          ref="emailInput"
          v-model="email"
          type="email"
          placeholder="you@example.com (optional)"
          icon="i-lucide-mail"
          size="xl"
          class="w-full"
        />

        <UButton
          ref="passkeyBtn"
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
          <div class="text-sm text-muted">
            Sign this challenge with your private key <span class="text-dimmed">({{ countdown }}s)</span>
          </div>

          <div class="relative">
            <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-default bg-default p-3 font-mono text-xs text-green-400">{{ signCommand }}</pre>
            <button
              class="absolute top-2 right-2 text-dimmed transition-colors hover:text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="Copy to clipboard"
              aria-label="Copy sign command"
              @click="copyCommand"
            >
              <UIcon name="i-lucide-copy" class="size-4" />
            </button>
          </div>

          <div class="text-xs text-dimmed">
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
              aria-label="Request a new challenge"
              @click="resetChallenge"
            />
          </div>
        </div>
      </div>

      <p v-if="webauthnError || challengeError" class="mt-3 text-sm text-red-400 text-center">
        {{ webauthnError || challengeError }}
      </p>

      <!-- Actionable recovery: triggered when the server says "no passkeys for
           this email" (for current RP domain). Sends the user to the email-
           based registration flow which adds a new passkey to the existing
           account without touching whatever credentials they already have. -->
      <div v-if="noPasskeyForDomain && email" class="mt-3 text-center text-sm text-muted">
        Kein Passkey für diese Domain hinterlegt.
        <NuxtLink :to="`/register-email?email=${encodeURIComponent(email)}`" class="text-primary hover:underline">
          Registrierungslink anfordern
        </NuxtLink>
      </div>

      <button
        class="mt-4 text-sm text-dimmed transition-colors hover:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click="keyMode = !keyMode; resetChallenge()"
      >
        {{ keyMode ? 'Sign in with Passkey instead' : 'Sign in with SSH Key instead' }}
      </button>

      <div class="mt-6 text-sm text-dimmed">
        Noch keinen Account?
        <NuxtLink to="/register-email" class="text-primary hover:underline">
          Jetzt registrieren
        </NuxtLink>
      </div>

      <div class="mt-2 text-sm text-dimmed">
        Lost access to your passkeys?
        <NuxtLink to="/recover/request" class="text-primary hover:underline">
          Recover account
        </NuxtLink>
      </div>

      <p class="mt-8 text-sm text-dimmed">
        Powered by <NuxtLink to="https://openape.ai" external class="text-muted transition-colors hover:text-default">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </IdpHero>
</template>
