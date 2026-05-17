<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Member {
  userEmail: string
  role: 'member' | 'admin'
  joinedAt: number
}

// Read-only members panel for DM rooms. Membership is fixed at room
// creation time by the contact-accept flow (`utils/contacts.ts`); the
// historical add/remove/role mutations were endpoints that let any
// admin enrol arbitrary emails as admins without consent. Removed in
// #276 along with the `kind:'channel'` model — see security audit
// 2026-05-04.
const props = defineProps<{
  open: boolean
  roomId: string
  myEmail: string | null | undefined
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const open = computed({
  get: () => props.open,
  set: v => emit('update:open', v),
})

const members = ref<Member[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)

async function load() {
  if (!props.roomId) return
  loading.value = true
  errorMsg.value = null
  try {
    members.value = await $fetch<Member[]>(`/api/rooms/${props.roomId}/members`)
  }
  catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not load members.'
  }
  finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) load()
})
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-md' }">
    <template #content>
      <div class="p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">
              Members
            </h2>
            <p class="text-xs text-zinc-500">
              DM rooms are bound to a contact pair — to leave, remove the contact.
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close"
            @click="open = false"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-400">
          {{ errorMsg }}
        </p>

        <div class="space-y-2">
          <p v-if="loading" class="text-sm text-zinc-500">
            Loading…
          </p>
          <ul v-else class="divide-y divide-zinc-800 -mx-2">
            <li v-for="m of members" :key="m.userEmail" class="px-2 py-2 flex items-center gap-2">
              <UIcon
                name="i-lucide-user"
                class="size-4 shrink-0 text-zinc-500"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">
                  {{ m.userEmail }}
                  <span v-if="m.userEmail === myEmail" class="text-xs text-zinc-500 font-normal">(you)</span>
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </UModal>
</template>
