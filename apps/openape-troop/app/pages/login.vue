<script setup lang="ts">
const { t } = useI18n()
useSeoMeta({ title: () => t('login.tabTitle') })
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-zinc-950 text-zinc-100">
    <main class="flex-1 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md space-y-4">
        <OpenApeOAuthErrorAlert
          class="text-left mb-6 w-full"
          :messages="{
            access_denied: $t('login.oauth.accessDenied'),
          }"
        />

        <UCard>
          <OpenApeAuth
            :title="$t('login.card.title')"
            :subtitle="$t('login.card.subtitle')"
            :button-text="$t('login.card.button')"
            post-login-redirect="/"
          />
        </UCard>
      </div>
    </main>
  </div>
</template>
