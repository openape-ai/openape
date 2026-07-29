<script setup lang="ts">
useSeoMeta({ title: 'Free Identity Provider' })

const { user } = useIdpAuth()

const issuer = 'id.openape.ai'
</script>

<template>
  <!-- Signed in: the identity the IdP publishes about you, then one way on. -->
  <IdpPage
    v-if="user"
    title="Your identity"
    subtitle="This is what OpenApe ID tells a service when you sign in."
  >
    <dl class="rounded-lg border border-default bg-default p-5 font-mono text-sm">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <dt class="w-12 shrink-0 text-dimmed">
          sub
        </dt>
        <dd class="min-w-0 break-all">
          {{ user.email }}
        </dd>
      </div>
      <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <dt class="w-12 shrink-0 text-dimmed">
          act
        </dt>
        <dd class="text-primary">
          human
        </dd>
      </div>
      <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <dt class="w-12 shrink-0 text-dimmed">
          iss
        </dt>
        <dd class="min-w-0 break-all text-muted">
          {{ issuer }}
        </dd>
      </div>
    </dl>

    <UButton
      to="/account"
      color="primary"
      size="lg"
      class="mt-6"
      trailing-icon="i-lucide-arrow-right"
    >
      Account &amp; security
    </UButton>

    <ClientOnly>
      <EnableNotifications />
    </ClientOnly>
  </IdpPage>

  <!-- Signed out -->
  <IdpHero v-else>
    <div class="flex flex-col items-center text-center">
      <div class="mb-6 text-6xl">
        🦍
      </div>

      <h1 class="mb-4 text-4xl font-extrabold sm:text-5xl">
        One login.<br>
        <span class="text-primary sm:whitespace-nowrap">Every human.<br class="sm:hidden"> Every agent.</span>
      </h1>

      <p class="mb-8 text-lg text-muted">
        Free identity provider for the open web. Secured by passkeys.
      </p>

      <div class="w-full space-y-3">
        <UButton
          to="/login"
          color="primary"
          size="xl"
          block
          icon="i-lucide-fingerprint"
        >
          Sign in with Passkey
        </UButton>

        <UButton
          to="/register-email"
          color="neutral"
          variant="outline"
          size="xl"
          block
          icon="i-lucide-user-plus"
        >
          Create account
        </UButton>
      </div>

      <p class="mt-8 text-sm text-dimmed">
        Powered by <NuxtLink to="https://openape.ai" external class="text-muted transition-colors hover:text-default">
          OpenApe
        </NuxtLink>
      </p>
    </div>
  </IdpHero>
</template>
