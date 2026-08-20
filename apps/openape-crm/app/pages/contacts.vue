<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface Contact { id: string, name: string, email: string | null, phone: string | null, org_id: string | null, org_name: string | null }
interface Organization { id: string, name: string, domain: string | null }

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { run } = useApiAction()

const loading = ref(true)
const loadError = ref('')
const contacts = ref<Contact[]>([])
const organizations = ref<Organization[]>([])
const newContact = ref({ name: '', email: '', phone: '', org_id: '' })
const newOrg = ref({ name: '', domain: '' })
const pendingDelete = ref<Contact | null>(null)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await loadWorkspaces()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Kontakte konnten nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(activeId, () => void reload())

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
  const created = await run(
    () => apiFetch('/api/contacts', {
      method: 'POST',
      body: { workspace_id: activeId.value, ...newContact.value, org_id: newContact.value.org_id || null },
    }),
    { success: `${newContact.value.name} angelegt`, failure: 'Kontakt konnte nicht angelegt werden' },
  )
  if (created === null) return
  newContact.value = { name: '', email: '', phone: '', org_id: '' }
  await run(() => reload(), { failure: 'Liste konnte nicht aktualisiert werden' })
}

async function addOrganization() {
  const created = await run(
    () => apiFetch('/api/organizations', {
      method: 'POST',
      body: { workspace_id: activeId.value, ...newOrg.value },
    }),
    { success: `${newOrg.value.name} angelegt`, failure: 'Firma konnte nicht angelegt werden' },
  )
  if (created === null) return
  newOrg.value = { name: '', domain: '' }
  await run(() => reload(), { failure: 'Liste konnte nicht aktualisiert werden' })
}

async function removeContact() {
  const contact = pendingDelete.value
  if (!contact) return
  const deleted = await run(
    () => apiFetch(`/api/contacts/${contact.id}`, { method: 'DELETE' }),
    { success: `${contact.name} gelöscht`, failure: 'Kontakt konnte nicht gelöscht werden' },
  )
  pendingDelete.value = null
  if (deleted === null) return
  await run(() => reload(), { failure: 'Liste konnte nicht aktualisiert werden' })
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

      <p v-if="loadError" class="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
        {{ loadError }}
      </p>

      <ul class="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        <li v-if="loading" class="p-6 text-center text-sm text-zinc-500">
          Lade …
        </li>
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
            @click="pendingDelete = contact"
          />
        </li>
        <li v-if="!loading && !contacts.length" class="p-6 text-center text-sm text-zinc-500">
          Noch keine Kontakte. Leg den ersten an — dann kannst du Deals daran hängen.
        </li>
      </ul>

      <h2 class="mt-10 text-lg font-semibold">
        Firmen
      </h2>
      <ul class="mt-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        <li v-if="loading" class="p-6 text-center text-sm text-zinc-500">
          Lade …
        </li>
        <li v-for="org in organizations" :key="org.id" class="p-3">
          <p class="font-medium">
            {{ org.name }}
          </p>
          <p class="text-xs text-zinc-400">
            {{ org.domain || '—' }}
          </p>
        </li>
        <li v-if="!loading && !organizations.length" class="p-6 text-center text-sm text-zinc-500">
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

    <ConfirmDialog
      :open="!!pendingDelete"
      title="Kontakt löschen?"
      :consequence="`${pendingDelete?.name} wird entfernt. Deals bleiben bestehen, verlieren aber die Verknüpfung.`"
      @update:open="pendingDelete = null"
      @confirm="removeContact"
    />
  </main>
</template>
