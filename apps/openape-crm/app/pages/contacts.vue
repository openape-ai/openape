<script setup lang="ts">
import { useOpenApeAuth } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'
import { NO_SELECTION, selectionToId } from '../utils/board'
import { problemMessage } from '../utils/problem-message'

definePageMeta({ alias: ['/kontakte'] })

interface Contact { id: string, name: string, email: string | null, phone: string | null, org_id: string | null, org_name: string | null }
interface Organization { id: string, name: string, domain: string | null }

const { user, fetchUser } = useOpenApeAuth()
const { activeId, load: loadWorkspaces } = useWorkspaces()
const { run } = useApiAction()

const loading = ref(true)
const loadError = ref('')
const contacts = ref<Contact[]>([])
const organizations = ref<Organization[]>([])
const newContact = ref({ name: '', email: '', phone: '', org_id: NO_SELECTION })
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
      body: { workspace_id: activeId.value, ...newContact.value, org_id: selectionToId(newContact.value.org_id) },
    }),
    { success: `${newContact.value.name} angelegt`, failure: 'Kontakt konnte nicht angelegt werden' },
  )
  if (created === null) return
  newContact.value = { name: '', email: '', phone: '', org_id: NO_SELECTION }
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
  { label: 'ohne Firma', value: NO_SELECTION },
  ...organizations.value.map(o => ({ label: o.name, value: o.id })),
])
</script>

<template>
  <div class="flex h-full flex-col md:flex-row">
    <div class="flex max-h-[45%] w-full shrink-0 flex-col overflow-hidden border-b border-[var(--crm-line)] bg-[var(--crm-panel)] md:max-h-none md:h-full md:w-[300px] md:border-r md:border-b-0">
      <header class="border-b border-[var(--crm-line)] px-3.5 py-3">
        <h2 class="text-[13px] font-semibold">
          Kontakte
        </h2>
      </header>
      <div class="flex-1 overflow-auto p-1.5">
        <p v-if="loadError" class="p-3 text-sm text-[var(--crm-rose)]">
          {{ loadError }}
        </p>
        <p v-if="loading" class="p-3 text-[var(--crm-ink-3)]">
          Lade …
        </p>
        <div
          v-for="contact in contacts"
          :key="contact.id"
          class="mb-0.5 flex items-center rounded-[7px] px-2.5 py-2 hover:bg-[var(--crm-panel-2)]"
        >
          <div class="min-w-0 flex-1">
            <b class="block font-medium">{{ contact.name }}</b>
            <div class="truncate text-[11.5px] text-[var(--crm-ink-3)]">
              <span v-if="contact.org_name">{{ contact.org_name }} · </span>{{ contact.email || '—' }}
            </div>
          </div>
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="`${contact.name} löschen`"
            @click="pendingDelete = contact"
          />
        </div>
        <p v-if="!loading && !contacts.length" class="p-3.5 text-[var(--crm-ink-3)]">
          Noch keine Kontakte.
        </p>
        <h3 class="mt-4 px-2 text-[10.5px] uppercase tracking-wide text-[var(--crm-ink-3)]">
          Firmen
        </h3>
        <div v-for="org in organizations" :key="org.id" class="px-2.5 py-2">
          <b class="block font-medium">{{ org.name }}</b>
          <div class="text-[11.5px] text-[var(--crm-ink-3)]">
            {{ org.domain || '—' }}
          </div>
        </div>
      </div>
    </div>
    <div class="flex-1 overflow-auto p-4 sm:p-6">
      <div class="grid max-w-xl gap-8">
        <form class="space-y-3" @submit.prevent="addContact">
          <h1 class="text-lg font-semibold">
            Kontakt anlegen
          </h1>
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
          <UButton type="submit" :disabled="!newContact.name.trim()">
            Speichern
          </UButton>
        </form>
        <form class="space-y-3" @submit.prevent="addOrganization">
          <h2 class="text-lg font-semibold">
            Firma anlegen
          </h2>
          <UFormField label="Name" required>
            <UInput v-model="newOrg.name" maxlength="200" class="w-full" />
          </UFormField>
          <UFormField label="Domain">
            <UInput v-model="newOrg.domain" placeholder="example.com" class="w-full" />
          </UFormField>
          <UButton type="submit" :disabled="!newOrg.name.trim()">
            Speichern
          </UButton>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="!!pendingDelete"
      title="Kontakt löschen?"
      :consequence="`${pendingDelete?.name} wird entfernt. Deals bleiben bestehen, verlieren aber die Verknüpfung.`"
      @update:open="pendingDelete = null"
      @confirm="removeContact"
    />
  </div>
</template>
