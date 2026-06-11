<script setup lang="ts">
// /recovery-protection — focus page in the account IA (#462): the vacation
// shield for the adaptive recovery cooldown and the permanent recovery
// history, one concern per page like /passkeys and friends.

useSeoMeta({ title: 'Recovery protection' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()

onMounted(async () => {
  await fetchUser()
  if (!user.value)
    await navigateTo('/login')
})
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Recovery protection
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/account" color="neutral" variant="soft" size="sm">
          Back
        </UButton>
      </div>

      <div v-if="authLoading" class="text-center text-muted mt-10">
        Loading...
      </div>

      <template v-else>
        <RecoveryVacationCard />
        <RecoveryHistoryCard />
      </template>
    </div>
  </div>
</template>
