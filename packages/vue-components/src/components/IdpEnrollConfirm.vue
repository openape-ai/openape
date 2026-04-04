<script setup lang="ts">
import { ref } from 'vue'
import { useIdpApi } from '../composables/useIdpApi'

interface EnrollResult {
  agent_id: string
}

const props = defineProps<{
  baseUrl?: string
  agentId?: string
  agentEmail: string
  agentName: string
  agentKey: string
  defaultOwner?: string
  defaultApprover?: string
}>()

const emit = defineEmits<{
  enrolled: [agentId: string]
  declined: []
  error: [message: string]
}>()

const { post } = useIdpApi(props.baseUrl)
const owner = ref(props.defaultOwner || '')
const approver = ref(props.defaultApprover || '')
const enrolling = ref(false)
const declined = ref(false)
const error = ref('')

const validParams = props.agentEmail && props.agentName && props.agentKey.startsWith('ssh-ed25519 ')

async function handleEnroll() {
  enrolling.value = true
  error.value = ''
  try {
    const data = await post<EnrollResult>('/api/agent/enroll', {
      id: props.agentId || undefined,
      email: props.agentEmail,
      name: props.agentName,
      publicKey: props.agentKey,
      owner: owner.value,
      approver: approver.value,
    })
    emit('enrolled', data.agent_id)
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : 'Enrollment failed'
    error.value = msg
    emit('error', msg)
  }
  finally {
    enrolling.value = false
  }
}
</script>

<template>
  <div>
    <UAlert
      v-if="!validParams"
      color="error"
      title="Invalid enrollment parameters"
      description="Missing or invalid email/name/key parameters."
    />

    <UAlert
      v-else-if="declined"
      color="neutral"
      title="Declined"
      description="No action taken. You can close this page."
    />

    <div v-else class="space-y-4">
      <UFormField label="Agent Email">
        <UInput :model-value="agentEmail" readonly class="font-mono text-xs" />
      </UFormField>

      <UFormField label="Agent Name">
        <UInput :model-value="agentName" readonly />
      </UFormField>

      <UFormField label="Public Key">
        <UInput :model-value="agentKey" readonly class="font-mono text-xs" />
      </UFormField>

      <UFormField label="Owner">
        <UInput v-model="owner" placeholder="Responsible for this agent" />
      </UFormField>

      <UFormField label="Approver">
        <UInput v-model="approver" placeholder="Approves grant requests" />
      </UFormField>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
        class="mt-2"
      />

      <div class="flex gap-3 pt-2">
        <UButton
          color="primary"
          :loading="enrolling"
          :disabled="enrolling || !owner || !approver"
          block
          class="flex-1"
          @click="handleEnroll"
        >
          Enroll Agent
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="enrolling"
          block
          class="flex-1"
          @click="declined = true; $emit('declined')"
        >
          Decline
        </UButton>
      </div>
    </div>
  </div>
</template>
