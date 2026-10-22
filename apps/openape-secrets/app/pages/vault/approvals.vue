<script setup lang="ts">
import type { ApprovalView } from '~/utils/vault-client'
import { computed, onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { endsAt, flowError, listApprovals, requesterName, revokeApproval, shortFingerprint } from '~/utils/vault-client'

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const approvals = ref<ApprovalView[]>([])
const error = ref('')
const notice = ref('')
const busy = ref<string | null>(null)

const GROUPS = [
  { mode: 'standing', title: 'Until revoked', hint: 'Ends when you revoke it, the machine gets a new key or the secret a new version.' },
  { mode: 'timed', title: 'For a while', hint: 'Collect as often as needed until the time runs out.' },
  { mode: 'once', title: 'Once', hint: 'One collection, then it closes by itself.' },
] as const

const active = computed(() => GROUPS.map(g => ({ ...g, rows: approvals.value.filter(a => a.status === 'active' && a.mode === g.mode) })).filter(g => g.rows.length))
const ended = computed(() => approvals.value.filter(a => a.status !== 'active'))
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

const ENDED_LABELS: Record<string, string> = {
  consumed: 'Collected',
  revoked: 'Revoked by you',
  expired: 'Expired',
  superseded: 'Replaced by a newer version',
}

function ends(a: ApprovalView) {
  return a.expires_at ? endsAt(a.expires_at) : 'When you revoke it'
}

async function revoke(a: ApprovalView) {
  busy.value = a.id
  error.value = ''
  try {
    await revokeApproval(a.id)
    approvals.value = await listApprovals()
    notice.value = `${a.consumer.name} can no longer collect ${a.secret.alias}.`
  }
  catch (err) {
    error.value = flowError(err)
  }
  finally {
    busy.value = null
  }
}

onMounted(async () => {
  await fetchUser()
  if (user.value) approvals.value = await listApprovals().catch((err) => { error.value = flowError(err); return [] })
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <VaultHeader :email="user?.sub" nav />

    <main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-8">
      <OpenApeAuth v-if="ready && !user" subtitle="Sign in to see your approvals." />

      <template v-else-if="ready">
        <div class="flex max-w-2xl flex-col gap-2">
          <h1 class="text-[34px] font-semibold leading-tight tracking-tight">
            Approvals
          </h1>
          <p class="text-muted">
            Which machine may collect which secret, and for how long. Revoking stops every future collection. A value a machine already collected stays on that machine.
          </p>
        </div>

        <p v-if="notice" role="status" class="-mt-4 flex items-center gap-2 text-brass">
          <UIcon name="i-lucide-circle-check" class="size-5 shrink-0" />
          {{ notice }}
        </p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="-mt-4" />

        <p v-if="!approvals.length" class="rounded-2xl border border-dashed border-accented p-6 text-muted">
          Nothing approved yet. When an agent asks for a secret, you approve it on the request page.
        </p>

        <section v-for="g in active" :key="g.mode" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h2 class="text-xl font-semibold tracking-tight">
              {{ g.title }}
            </h2>
            <span class="text-sm text-dimmed">{{ g.hint }}</span>
          </div>
          <ul class="flex flex-col rounded-2xl border border-default bg-muted p-1.5">
            <li v-for="a in g.rows" :key="a.id" class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-3.5 py-3">
              <div class="flex min-w-0 flex-[1_1_200px] items-center gap-3">
                <KeySeal :fingerprint="a.consumer.fingerprint" :size="36" tone="brass" />
                <div class="min-w-0">
                  <div class="font-semibold">
                    {{ a.consumer.name }}
                  </div>
                  <div class="font-mono text-xs tracking-[0.04em] text-dimmed">
                    {{ shortFingerprint(a.consumer.fingerprint) }}
                  </div>
                </div>
              </div>
              <div class="min-w-0 flex-[1_1_220px]">
                <div class="truncate font-mono text-sm">
                  {{ a.secret.alias }}
                </div>
                <div class="text-[13px] text-dimmed">
                  Version {{ a.secret.version }} for {{ requesterName(a.requester) }}
                </div>
              </div>
              <div class="flex-[0_0_170px] text-sm">
                {{ ends(a) }}
              </div>
              <UButton color="error" variant="outline" :loading="busy === a.id" :disabled="!!busy" @click="revoke(a)">
                Revoke
              </UButton>
            </li>
          </ul>
        </section>

        <section v-if="ended.length" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h2 class="text-xl font-semibold tracking-tight">
              Ended
            </h2>
            <span class="text-sm text-dimmed">Kept as a record. Nothing here can be collected.</span>
          </div>
          <ul class="flex flex-col rounded-2xl border border-default p-1.5 text-sm text-muted">
            <li v-for="a in ended" :key="a.id" class="flex flex-wrap gap-x-4 gap-y-1 px-3.5 py-2.5">
              <span class="flex-[0_0_140px]">{{ a.consumer.name }}</span>
              <span class="min-w-0 flex-1 truncate font-mono text-[13px]">{{ a.secret.alias }} v{{ a.secret.version }}</span>
              <span class="flex-[0_0_200px] text-default">{{ ENDED_LABELS[a.status] ?? a.status }}</span>
              <span class="text-dimmed">{{ day(a.revoked_at ?? a.consumed_at ?? a.expires_at ?? a.created_at) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
