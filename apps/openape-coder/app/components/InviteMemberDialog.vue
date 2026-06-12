<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{ projectId: string, projectName: string }>()
const open = defineModel<boolean>('open', { default: false })

const email = ref('')
const submitting = ref(false)
const error = ref('')
const addedTo = ref('')

// The app sends no email itself. The mailto link is a pure client-side
// convenience: it opens the admin's own mail client with a prefilled note so
// they can nudge the person to sign in. Built from the typed address + project
// name only — it reveals nothing the admin did not already type.
const origin = ref('')
onMounted(() => { origin.value = window.location.origin })

const mailtoHref = computed(() => {
  const subject = `You've been added to ${props.projectName} on OpenApe Coder`
  const body = `Hi,\n\nI added you to the project "${props.projectName}" on OpenApe Coder. `
    + `Sign in with your email and passkey to see it:\n${origin.value}\n`
  return `mailto:${addedTo.value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
})

watch(open, (now) => {
  if (!now) return
  email.value = ''
  error.value = ''
  addedTo.value = ''
  submitting.value = false
})

async function submit() {
  if (!email.value.trim()) return
  submitting.value = true
  error.value = ''
  try {
    await ($fetch as any)(`/api/projects/${props.projectId}/invites`, {
      method: 'POST',
      body: { email: email.value.trim() },
    })
    // Same acknowledgement for every address — we never reveal whether the
    // person already has an identity (coder-invite-members §6). The roster does
    // not change on invite (a pending invite is not a member until the person
    // signs in), so we keep the success state up instead of reloading the page.
    addedTo.value = email.value.trim()
    email.value = ''
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Could not add the member.'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md' }">
    <template #content>
      <div class="p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              Add a member
            </h3>
            <p class="text-xs text-muted mt-1">
              They join as a read-only member the first time they sign in, and see it in their inbox. Unlock write access per person afterwards.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="open = false" />
        </div>

        <div v-if="addedTo" class="space-y-3">
          <UAlert
            color="success"
            icon="i-lucide-user-check"
            :title="`${addedTo} is now a member`"
            description="They'll see it in their inbox the next time they sign in with that identity. No email is sent."
          />
          <UButton
            :to="mailtoHref"
            external
            color="neutral"
            variant="subtle"
            icon="i-lucide-mail"
            block
          >
            Email them a heads-up (optional)
          </UButton>
        </div>

        <UFormField v-else label="Email address">
          <UInput
            v-model="email"
            type="email"
            placeholder="person@example.com"
            size="lg"
            class="w-full"
            :ui="{ base: 'w-full' }"
            @keydown.enter="submit"
          />
        </UFormField>

        <UAlert v-if="error" color="error" :title="error" />

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="open = false">
            {{ addedTo ? 'Done' : 'Close' }}
          </UButton>
          <UButton
            v-if="!addedTo"
            color="primary"
            :loading="submitting"
            :disabled="!email.trim()"
            icon="i-lucide-user-plus"
            @click="submit"
          >
            Add member
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
