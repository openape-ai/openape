<script setup lang="ts">
// /recovery-protection — focus page in the account IA (#462): the vacation
// shield for the adaptive recovery cooldown and the permanent recovery
// history, one concern per page like /passkeys and friends.

useSeoMeta({ title: 'Recovery protection' })

const { user, loading: authLoading } = useIdpAuth()

onMounted(async () => {
  if (!user.value)
    await navigateTo('/login')
})
</script>

<template>
  <IdpPage title="Recovery protection" :subtitle="user?.email" back-to="/account" back-label="Account">
    <div v-if="authLoading" class="mt-10 text-center text-muted">
      Loading...
    </div>

    <template v-else>
      <RecoveryVacationCard />
      <RecoveryHistoryCard />
    </template>
  </IdpPage>
</template>
