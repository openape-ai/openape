<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: ['dashboard-auth'] })

useSeoMeta({ title: 'Settings' })

const { data: stats } = await useFetch('/api/platform/stats')

const orgName = ref(stats.value?.org?.name || '')
const customDomain = ref('')
const saving = ref(false)
const message = ref('')

async function saveSettings() {
  saving.value = true
  message.value = ''
  try {
    const slug = stats.value?.org?.slug
    await $fetch(`/api/platform/orgs/${slug}`, {
      method: 'PUT',
      body: {
        name: orgName.value,
        customDomain: customDomain.value || undefined,
      },
    })
    message.value = 'Settings saved.'
  }
  catch (err: any) {
    message.value = err.data?.detail || err.data?.title || 'Failed to save'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl">
    <h1 class="text-2xl font-bold mb-6">Settings</h1>

    <form class="space-y-6" @submit.prevent="saveSettings">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-4">
        <h2 class="text-lg font-semibold">Organization</h2>
        <UFormField label="Name">
          <UInput v-model="orgName" class="w-full" />
        </UFormField>
        <UFormField label="Slug">
          <UInput :model-value="stats?.org?.slug" disabled class="w-full" />
        </UFormField>
      </div>

      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-4">
        <h2 class="text-lg font-semibold">Custom Domain</h2>
        <p class="text-sm text-gray-400">
          Set a custom domain for your identity provider. After saving, point a CNAME record to <code class="text-gray-300">cname.vercel-dns.com</code>.
        </p>
        <UAlert color="warning" title="Passkeys are domain-bound" description="Users will need to register new passkeys after switching to a custom domain." />
        <UFormField label="Domain">
          <UInput v-model="customDomain" placeholder="id.acme.com" class="w-full" />
        </UFormField>
      </div>

      <UAlert v-if="message" :color="message === 'Settings saved.' ? 'success' : 'error'" :title="message" />

      <UButton type="submit" label="Save Settings" :loading="saving" />
    </form>
  </div>
</template>
