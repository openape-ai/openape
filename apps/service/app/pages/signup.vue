<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({ title: 'Sign Up' })

const slug = ref('')
const name = ref('')
const adminEmail = ref('')
const error = ref('')
const loading = ref(false)

const slugPreview = computed(() => {
  const config = useRuntimeConfig()
  const domain = config.public.domain
  return slug.value ? `${slug.value}.${domain}` : ''
})

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    const result = await $fetch<{ org: any, redirectUrl: string }>('/api/platform/orgs', {
      method: 'POST',
      body: { slug: slug.value, name: name.value, adminEmail: adminEmail.value },
    })
    navigateTo(result.redirectUrl, { external: true })
  }
  catch (err: any) {
    error.value = err.data?.detail || err.data?.title || err.message || 'Something went wrong'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto py-20 px-4">
    <h1 class="text-3xl font-bold mb-2">
      Create your organization
    </h1>
    <p class="text-gray-400 mb-8">
      Get started with OpenApe Cloud in seconds.
    </p>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <UFormField label="Organization name">
        <UInput v-model="name" placeholder="Acme Corp" required class="w-full" />
      </UFormField>

      <UFormField label="URL slug" :hint="slugPreview ? `→ ${slugPreview}` : ''">
        <UInput
          v-model="slug"
          placeholder="acme"
          pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField label="Admin email">
        <UInput v-model="adminEmail" type="email" placeholder="admin@acme.com" required class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :title="error" />

      <UButton type="submit" label="Create Organization" color="primary" block :loading="loading" />
    </form>
  </div>
</template>
