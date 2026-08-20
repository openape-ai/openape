<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'

interface Contact { id: string, name: string, email: string | null, phone: string | null, org_id: string | null, org_name: string | null }
interface Organization { id: string, name: string, domain: string | null }

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()

const contacts = ref<Contact[]>([])
const organizations = ref<Organization[]>([])
const newContact = ref({ name: '', email: '', phone: '', org_id: '' })
const newOrg = ref({ name: '', domain: '' })

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  await loadWorkspaces()
  await reload()
})

watch(activeId, reload)

async function reload() {
  if (!activeId.value) return
  const [c, o] = await Promise.all([
    apiFetch<Contact[]>(`/api/contacts?workspace_id=${activeId.value}`),
    apiFetch<Organization[]>(`/api/organizations?workspace_id=${activeId.value}`),
  ])
  contacts.value = c
  organizations.value = o
}

async function addContact() {
  await apiFetch('/api/contacts', {
    method: 'POST',
    body: { workspace_id: activeId.value, ...newContact.value, org_id: newContact.value.org_id || null },
  })
  newContact.value = { name: '', email: '', phone: '', org_id: '' }
  await reload()
}

async function addOrganization() {
  await apiFetch('/api/organizations', {
    method: 'POST',
    body: { workspace_id: activeId.value, ...newOrg.value },
  })
  newOrg.value = { name: '', domain: '' }
  await reload()
}

async function removeContact(id: string) {
  await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' })
  await reload()
}

const orgItems = computed(() => [
  { label: 'ohne Firma', value: '' },
  ...organizations.value.map(o => ({ label: o.name, value: o.id })),
])
</script>

<template>
  <main class="mx-auto grid max-w-7xl gap-8 px-4 py-6 lg:grid-cols-3">
    <section class="lg:col-span-2">
      <h1 class="text-xl font-semibold">
        Kontakte
      </h1>

      <ul class="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        <li v-for="contact in contacts" :key="contact.id" class="flex items-center gap-4 p-3">
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              {{ contact.name }}
            </p>
            <p class="truncate text-xs text-zinc-400">
              <span v-if="contact.org_name">{{ contact.org_name }} · </span>{{ contact.email || '—' }}
              <span v-if="contact.phone"> · {{ contact.phone }}</span>
            </p>
          </div>
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="`${contact.name} löschen`"
            @click="removeContact(contact.id)"
          />
        </li>
        <li v-if="!contacts.length" class="p-6 text-center text-sm text-zinc-500">
          Noch keine Kontakte.
        </li>
      </ul>

      <h2 class="mt-10 text-lg font-semibold">
        Firmen
      </h2>
      <ul class="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        <li v-for="org in organizations" :key="org.id" class="p-3">
          <p class="font-medium">
            {{ org.name }}
          </p>
          <p class="text-xs text-zinc-400">
            {{ org.domain || '—' }}
          </p>
        </li>
        <li v-if="!organizations.length" class="p-6 text-center text-sm text-zinc-500">
          Noch keine Firmen.
        </li>
      </ul>
    </section>

    <section class="space-y-8">
      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Kontakt anlegen
          </h2>
        </template>
        <form class="space-y-3" @submit.prevent="addContact">
          <UFormField label="Name" required>
            <UInput v-model="newContact.name" maxlength="200" class="w-full" />
          </UFormField>
          <UFormField label="E-Mail">
            <UInput v-model="newContact.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Telefon">
            <UInput v-model="newContact.phone" class="w-full" />
          </UFormField>
          <UFormField label="Firma">
            <USelect v-model="newContact.org_id" :items="orgItems" class="w-full" />
          </UFormField>
          <UButton type="submit" block :disabled="!newContact.name.trim()">
            Speichern
          </UButton>
        </form>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            Firma anlegen
          </h2>
        </template>
        <form class="space-y-3" @submit.prevent="addOrganization">
          <UFormField label="Name" required>
            <UInput v-model="newOrg.name" maxlength="200" class="w-full" />
          </UFormField>
          <UFormField label="Domain">
            <UInput v-model="newOrg.domain" placeholder="example.com" class="w-full" />
          </UFormField>
          <UButton type="submit" block :disabled="!newOrg.name.trim()">
            Speichern
          </UButton>
        </form>
      </UCard>
    </section>
  </main>
</template>
