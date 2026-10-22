<script setup lang="ts">
import type { ApprovalMode, OwnerRequest, SecretType, VaultView } from '~/utils/vault-client'
import { computed, onMounted, ref } from 'vue'
import { useOpenApeAuth, useRoute } from '#imports'
import { approveRequest, denyRequest, endsAt, flowError, loadVault, readRequest, requesterName, revokeApproval, saveSecret, shortFingerprint } from '~/utils/vault-client'

const ONCE_WINDOW_SEC = 24 * 60 * 60
const DURATIONS = [
  { label: '15 min', sec: 15 * 60 },
  { label: '1 hour', sec: 60 * 60 },
  { label: '1 day', sec: 24 * 60 * 60 },
  { label: '7 days', sec: 7 * 24 * 60 * 60 },
]
const MODES: Array<{ id: ApprovalMode, label: string }> = [
  { id: 'once', label: 'Once' },
  { id: 'timed', label: 'For a while' },
  { id: 'standing', label: 'Until revoked' },
]

const route = useRoute()
const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const request = ref<OwnerRequest | null>(null)
const vault = ref<VaultView | null>(null)
const loadError = ref('')
const mode = ref<ApprovalMode>('once')
const duration = ref(DURATIONS[0]!.sec)
const busy = ref<'approve' | 'deny' | 'revoke' | 'save' | null>(null)
const error = ref('')
const revoked = ref(false)
const editorOpen = ref(false)
const editorError = ref('')

const id = computed(() => String(route.params.id ?? ''))
const machine = computed(() => request.value?.consumer.name ?? 'the machine')
const title = computed(() => request.value ? `${requesterName(request.value.requester)} needs ${request.value.field_name}` : '')
const nowSec = () => Math.floor(Date.now() / 1000)

/** What the chosen mode means, in one sentence with the exact end. */
const terms = computed(() => {
  const r = request.value
  if (!r) return ''
  const version = r.secret ? `version ${r.secret.version}` : 'it'
  if (mode.value === 'once') return `${machine.value} can collect it one time, until ${endsAt(nowSec() + ONCE_WINDOW_SEC)}.`
  if (mode.value === 'timed') return `${machine.value} can collect it as often as needed until ${endsAt(nowSec() + duration.value)}.`
  return `${machine.value} can collect ${version} until you revoke it. A new version needs a new approval.`
})

const canApprove = computed(() => !!request.value?.secret && !request.value.consumer.key_changed)
const approved = computed(() => request.value?.status === 'approved' && request.value.approval)
const receipt = computed(() => {
  const a = request.value?.approval
  if (!a) return ''
  const alias = request.value!.field_name
  if (a.mode === 'once') return `${requesterName(request.value!.requester)} can collect ${alias} one time, until ${endsAt(a.expires_at!)}.`
  if (a.mode === 'timed') return `${requesterName(request.value!.requester)} can collect ${alias} as often as needed until ${endsAt(a.expires_at!)}.`
  return `${requesterName(request.value!.requester)} can collect ${alias} until you revoke it.`
})
const askedAt = computed(() => {
  const asked = endsAt(request.value?.created_at ?? 0)
  return asked.endsWith(' today') ? `at ${asked.replace(' today', '')}` : asked
})
const time = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

async function load() {
  try {
    const [r, v] = await Promise.all([readRequest(id.value), loadVault()])
    request.value = r
    vault.value = v
  }
  catch (err) {
    loadError.value = flowError(err)
  }
}

async function run(kind: 'approve' | 'deny' | 'revoke' | 'save', action: () => Promise<void>, onError = (m: string) => { error.value = m }) {
  busy.value = kind
  error.value = ''
  try {
    await action()
  }
  catch (err) {
    onError(flowError(err))
  }
  finally {
    busy.value = null
  }
}

function approve() {
  return run('approve', async () => {
    await approveRequest(vault.value!, id.value, mode.value === 'timed' ? { mode: 'timed', durationSec: duration.value } : { mode: mode.value })
    await load()
  })
}
function deny() {
  return run('deny', async () => {
    await denyRequest(id.value)
    await load()
  })
}
function revoke() {
  return run('revoke', async () => {
    await revokeApproval(request.value!.approval!.id)
    revoked.value = true
  })
}
function saveMissing(input: { alias: string, type: SecretType, value: string }) {
  return run('save', async () => {
    await saveSecret(vault.value!, { alias: input.alias, type: input.type, value: input.value })
    editorOpen.value = false
    await load()
  }, (m) => { editorError.value = m })
}

onMounted(async () => {
  await fetchUser()
  if (user.value) await load()
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <main class="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 pb-6 pt-4">
      <div class="flex h-10 items-center justify-between">
        <NuxtLink to="/vault" class="flex items-center gap-2 font-semibold">
          <svg viewBox="0 0 100 100" width="26" height="26" aria-hidden="true">
            <rect width="100" height="100" rx="22" fill="#212C3A" />
            <g fill="none" stroke="#38BDF8" stroke-width="7" stroke-linecap="round">
              <path d="M50 58a10 10 0 0 1 0-16" />
              <path d="M38 66a24 24 0 0 1 0-32" />
              <path d="M26 74a40 40 0 0 1 0-48" />
            </g>
            <circle cx="60" cy="50" r="7" fill="#38BDF8" />
          </svg>
          Secrets
        </NuxtLink>
        <NuxtLink v-if="approved" to="/vault" class="text-sm font-medium text-sky-300">
          Open vault
        </NuxtLink>
      </div>

      <OpenApeAuth v-if="ready && !user" subtitle="Sign in to see what is being asked for." />
      <UAlert v-else-if="ready && loadError" color="error" variant="subtle" :title="loadError" />

      <!-- Approved: the receipt. -->
      <template v-else-if="ready && request && approved">
        <div class="flex flex-col items-center gap-4 pt-5 text-center">
          <div class="relative size-[148px]">
            <KeySeal :fingerprint="request.consumer.fingerprint" :size="148" tone="brass" ground />
            <span class="absolute bottom-1.5 right-0.5 flex size-10 items-center justify-center rounded-full bg-brass text-[#1F1808] ring-[5px] ring-[#121923]" aria-hidden="true">
              <UIcon name="i-lucide-check" class="size-6" />
            </span>
          </div>
          <h1 class="text-[28px] font-semibold leading-tight tracking-tight">
            {{ revoked ? `Revoked for ${machine}` : `Approved for ${machine}` }}
          </h1>
          <p class="max-w-[300px] text-muted">
            {{ revoked ? `${machine} can no longer collect ${request.field_name}. A value it already collected stays on that machine.` : receipt }}
          </p>
        </div>

        <ol aria-label="Progress" class="flex flex-col rounded-[18px] border border-default bg-muted p-[18px]">
          <li class="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3 pb-3.5">
            <span class="m-[5px] size-3 rounded-full bg-brass" aria-hidden="true" />
            <span>Requested by {{ requesterName(request.requester) }}</span>
            <span class="text-sm text-dimmed">{{ time(request.created_at) }}</span>
          </li>
          <li class="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3 pb-3.5">
            <span class="m-[5px] size-3 rounded-full bg-brass" aria-hidden="true" />
            <span>You approved with your passkey</span>
            <span class="text-sm text-dimmed">{{ time(request.approval!.created_at) }}</span>
          </li>
          <li class="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-3">
            <span class="m-[5px] size-3 rounded-full border-2 border-[#8492A4]" aria-hidden="true" />
            <span class="text-muted">{{ revoked ? 'Revoked before collection' : `Waiting for ${machine} to collect` }}</span>
          </li>
        </ol>
        <p v-if="!revoked" class="text-center text-sm text-dimmed">
          You can close this page. {{ machine }} collects without you.
        </p>

        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <div class="mt-auto flex flex-col gap-2">
          <UButton v-if="!revoked" color="error" variant="outline" size="xl" block :loading="busy === 'revoke'" @click="revoke">
            Revoke approval
          </UButton>
          <UButton color="neutral" variant="ghost" size="xl" block to="/vault">
            Open vault
          </UButton>
        </div>
      </template>

      <!-- Decided otherwise or lapsed. -->
      <section v-else-if="ready && request && request.status !== 'pending_approval'" class="flex flex-col gap-3 rounded-[18px] border border-default bg-muted p-5">
        <h1 class="text-xl font-semibold">
          This request is {{ request.status.replace('_', ' ') }}
        </h1>
        <p class="text-muted">
          Nothing more will happen with it. If {{ machine }} still needs {{ request.field_name }}, it has to ask again.
        </p>
        <UButton to="/vault" color="neutral" variant="subtle" class="self-start">
          Open vault
        </UButton>
      </section>

      <!-- Waiting for a decision. -->
      <template v-else-if="ready && request">
        <div class="flex flex-col gap-1.5">
          <h1 class="break-words text-[26px] font-semibold leading-[1.18] tracking-tight">
            {{ title }}
          </h1>
          <p class="text-sm text-muted">
            Asked {{ askedAt }}. The request stays open until {{ endsAt(request.expires_at) }}.
          </p>
        </div>

        <div class="flex flex-col gap-3.5 rounded-[18px] border border-default bg-muted p-4">
          <div class="flex items-center gap-3.5">
            <KeySeal :fingerprint="request.consumer.fingerprint" :size="58" />
            <div class="min-w-0">
              <div class="text-[13px] text-dimmed">
                Goes to
              </div>
              <div class="text-[17px] font-semibold">
                {{ machine }}
              </div>
              <div class="font-mono text-xs tracking-[0.04em] text-muted">
                {{ shortFingerprint(request.consumer.fingerprint) }}
              </div>
            </div>
          </div>
          <div class="h-px bg-[#2B3747]" />
          <dl class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <dt class="text-dimmed">
              Secret
            </dt>
            <dd class="flex min-w-0 items-center gap-2">
              <span class="truncate font-mono text-[13px]">{{ request.field_name }}</span>
              <span v-if="request.secret" class="shrink-0 rounded-full bg-elevated px-2 text-xs text-muted">v{{ request.secret.version }}</span>
            </dd>
            <dt class="text-dimmed">
              Asked by
            </dt>
            <dd>
              <span class="font-medium">{{ requesterName(request.requester) }}</span><br>
              <span class="break-all text-[13px] text-dimmed">{{ request.requester }}</span>
            </dd>
            <template v-if="request.purpose">
              <dt class="text-dimmed">
                Reason
              </dt>
              <dd>“{{ request.purpose }}”</dd>
            </template>
          </dl>
        </div>

        <UAlert v-if="request.consumer.key_changed" color="warning" variant="subtle" title="The machine key changed since this request" description="Approving is blocked. Ask the agent to request it again from the machine." />

        <div v-if="!request.secret" class="flex flex-col items-start gap-3 rounded-[18px] border border-dashed border-accented p-4">
          <p class="text-sm">
            <span class="font-mono">{{ request.field_name }}</span> is not in your vault yet. Add it, then approve.
          </p>
          <UButton icon="i-lucide-plus" @click="editorOpen = true">
            Add it to your vault
          </UButton>
        </div>

        <div v-else class="flex flex-col gap-2.5">
          <h2 class="text-[15px] font-semibold">
            How often may it collect?
          </h2>
          <div role="group" aria-label="Collection mode" class="grid grid-cols-3 gap-1 rounded-[14px] border border-default bg-muted p-1">
            <button
              v-for="m in MODES"
              :key="m.id"
              type="button"
              :aria-pressed="mode === m.id"
              class="min-h-11 rounded-[10px] border px-1.5 text-sm"
              :class="mode === m.id ? 'border-primary bg-[#16344A] font-semibold text-default' : 'border-transparent text-muted'"
              @click="mode = m.id"
            >
              {{ m.label }}
            </button>
          </div>
          <div v-if="mode === 'timed'" role="group" aria-label="Duration" class="flex flex-wrap gap-1.5">
            <button
              v-for="d in DURATIONS"
              :key="d.sec"
              type="button"
              :aria-pressed="duration === d.sec"
              class="min-h-11 rounded-full border px-3.5 text-sm"
              :class="duration === d.sec ? 'border-primary bg-[#16344A] font-semibold text-default' : 'border-default text-muted'"
              @click="duration = d.sec"
            >
              {{ d.label }}
            </button>
          </div>
          <p class="flex items-start gap-2 text-sm text-muted">
            <UIcon name="i-lucide-clock" class="mt-0.5 size-[18px] shrink-0" />
            <span>{{ terms }}</span>
          </p>
        </div>

        <UAlert v-if="error" color="error" variant="subtle" :title="error" />

        <div class="mt-auto flex flex-col gap-2">
          <UButton size="xl" block icon="i-lucide-key-round" :color="canApprove ? 'primary' : 'neutral'" :variant="canApprove ? 'solid' : 'subtle'" :disabled="!canApprove || !!busy" :loading="busy === 'approve'" class="min-h-[54px] text-base" @click="approve">
            Approve with passkey
          </UButton>
          <UButton color="neutral" variant="ghost" size="xl" block :loading="busy === 'deny'" :disabled="!!busy" @click="deny">
            Deny
          </UButton>
          <p class="text-center text-[12.5px] text-dimmed">
            Your passkey confirms it’s you. The value is encrypted for {{ machine }} alone.
          </p>
        </div>

        <SecretEditor v-model:open="editorOpen" :secret="null" :preset-alias="request.field_name" :busy="busy === 'save'" :error="editorError" @save="saveMissing" />
      </template>
    </main>
  </div>
</template>
