<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import AppTopBar from './AppTopBar.vue'

defineProps<{ status: number | undefined, returnTo: string }>()
</script>

<template>
  <div class="surface">
    <AppTopBar search="" @search="q => navigateTo({ path: '/reports', query: { q } })" />
    <div class="wrap">
      <div class="sheet">
        <div v-if="status === 401" class="empty">
          <div class="empty-mark">
            <AppIcon name="lock" />
          </div>
          <h2>Sign in to read this report</h2>
          <p>Reports stay private until their owner shares them. Sign in with an account that has access.</p>
          <div class="acts">
            <NuxtLink class="btn primary" :to="{ path: '/', query: { returnTo } }">
              Sign in with OpenApe
            </NuxtLink>
          </div>
        </div>
        <div v-else class="empty">
          <div class="empty-mark">
            <AppIcon name="alert" />
          </div>
          <h2>This report isn't available</h2>
          <p>It may have been removed, or your access changed. Ask the owner to share it again, or check Recently removed.</p>
          <div class="acts">
            <NuxtLink class="btn" to="/reports">
              All reports
            </NuxtLink>
            <NuxtLink class="btn quiet" to="/reports/removed">
              Recently removed
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 24px 20px 80px; }
@media (max-width: 760px) { .wrap { padding: 14px 12px 80px; } }
</style>
