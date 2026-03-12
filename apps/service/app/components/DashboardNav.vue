<script setup lang="ts">
const route = useRoute()

const navItems = [
  { label: 'Overview', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Users', to: '/dashboard/users', icon: 'i-lucide-users' },
  { label: 'Agents', to: '/dashboard/agents', icon: 'i-lucide-bot' },
  { label: 'Grants', to: '/dashboard/grants', icon: 'i-lucide-shield-check' },
  { label: 'Settings', to: '/dashboard/settings', icon: 'i-lucide-settings' },
  { label: 'Billing', to: '/dashboard/billing', icon: 'i-lucide-credit-card' },
]

function isActive(to: string) {
  if (to === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(to)
}

async function logout() {
  await $fetch('/api/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <aside class="w-64 border-r border-gray-800 min-h-screen p-4 flex flex-col">
    <div class="text-lg font-bold mb-6 px-2">
      OpenApe Cloud
    </div>

    <nav class="flex-1 space-y-1">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="isActive(item.to) ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'"
      >
        <span :class="item.icon" class="w-5 h-5" />
        {{ item.label }}
      </NuxtLink>
    </nav>

    <div class="border-t border-gray-800 pt-4 mt-4">
      <UButton label="Logout" variant="ghost" color="neutral" block @click="logout" />
    </div>
  </aside>
</template>
