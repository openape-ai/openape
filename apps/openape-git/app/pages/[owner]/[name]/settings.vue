<script setup lang="ts">
import { ref } from 'vue'

interface RepoGrant {
  id: string
  delegate: string
  access: 'read' | 'write' | 'admin'
  status: string
  createdAt: number
  expiresAt: number | null
}

interface Webhook {
  id: string
  url: string
  createdAt: number
}

interface Delivery {
  id: string
  event: string
  ref: string
  statusCode: number | null
  error: string | null
  durationMs: number
  createdAt: number
}

interface Mirror {
  id: string
  url: string
  username: string
  enabled: number
  createdAt: number
}

interface MirrorState {
  mirrorId: string
  ref: string
  sourceSha: string | null
  targetSha: string | null
  checkedAt: number
  syncedAt: number | null
  error: string | null
}

interface MirrorPush {
  id: string
  ref: string
  sha: string
  ok: number
  error: string | null
  durationMs: number
  createdAt: number
}

interface RepoDetail {
  id: string
  owner: string
  name: string
  defaultBranch: string
  grants: RepoGrant[]
  webhooks: Webhook[]
  deliveries: Delivery[]
}

const route = useRoute()
const owner = route.params.owner as string
const name = route.params.name as string

const repo = ref<RepoDetail | null>(null)
const error = ref('')
const grantDelegate = ref('')
const grantAccess = ref<'read' | 'write' | 'admin'>('read')
const granting = ref(false)

const mirrors = ref<Mirror[]>([])
const mirrorPushes = ref<MirrorPush[]>([])
const mirrorStates = ref<MirrorState[]>([])
const reconciling = ref(false)
const mirrorUrl = ref('')
const mirrorUser = ref('')
const mirrorToken = ref('')
const addingMirror = ref(false)

async function loadMirrors() {
  const data = await $fetch<{ mirrors: Mirror[], pushes: MirrorPush[], states: MirrorState[] }>(`/api/repos/${owner}/${name}/mirrors`)
  mirrors.value = data.mirrors
  mirrorPushes.value = data.pushes
  mirrorStates.value = data.states
}

async function onReconcile() {
  reconciling.value = true
  try {
    await $fetch(`/api/repos/${owner}/${name}/mirrors/reconcile`, { method: 'POST' })
    await loadMirrors()
  }
  catch { error.value = 'Could not queue mirror reconciliation.' }
  finally { reconciling.value = false }
}

async function onAddMirror() {
  if (addingMirror.value) return
  addingMirror.value = true
  error.value = ''
  try {
    await $fetch(`/api/repos/${owner}/${name}/mirrors`, {
      method: 'POST',
      body: { url: mirrorUrl.value.trim(), username: mirrorUser.value.trim(), token: mirrorToken.value },
    })
    mirrorUrl.value = ''
    mirrorUser.value = ''
    mirrorToken.value = ''
    await loadMirrors()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Could not add the mirror.'
  }
  finally {
    addingMirror.value = false
  }
}

async function onDeleteMirror(id: string) {
  await $fetch(`/api/mirrors/${id}`, { method: 'DELETE' })
  await loadMirrors()
}

onMounted(async () => {
  await Promise.all([load(), loadMirrors()])
})

async function load() {
  try {
    repo.value = await $fetch<RepoDetail>(`/api/repos/${owner}/${name}`)
  }
  catch {
    error.value = 'Repo not found (or not yours). Grants are owner-only.'
  }
}

async function onGrant() {
  if (granting.value) return
  granting.value = true
  error.value = ''
  try {
    await $fetch(`/api/repos/${owner}/${name}/grants`, {
      method: 'POST',
      body: { delegate: grantDelegate.value, access: grantAccess.value },
    })
    grantDelegate.value = ''
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Grant failed'
  }
  finally {
    granting.value = false
  }
}

const hookUrl = ref('')
const newSecret = ref('')
const subscribing = ref(false)

async function onSubscribe() {
  if (subscribing.value) return
  subscribing.value = true
  error.value = ''
  try {
    const hook = await $fetch<{ secret: string }>(`/api/repos/${owner}/${name}/webhooks`, {
      method: 'POST',
      body: { url: hookUrl.value.trim() },
    })
    // Shown once: the consumer needs it to verify deliveries and to sign back.
    newSecret.value = hook.secret
    hookUrl.value = ''
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Subscribe failed'
  }
  finally {
    subscribing.value = false
  }
}

async function onDeleteHook(id: string) {
  error.value = ''
  try {
    await $fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Delete failed'
  }
}

function deliveryLabel(delivery: Delivery): string {
  const outcome = delivery.error ?? `HTTP ${delivery.statusCode}`
  return `${delivery.event} ${delivery.ref} - ${outcome} (${delivery.durationMs} ms)`
}

async function onRevoke(id: string) {
  error.value = ''
  try {
    await $fetch(`/api/grants/${id}/revoke`, { method: 'POST' })
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Revoke failed'
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <RepoHeader :owner="owner" :name="name" tab="settings" />

    <main class="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

      <template v-if="repo">
        <section>
          <h2 class="text-xl font-semibold mb-3">
            Access grants
          </h2>
          <p class="mb-4 text-sm text-zinc-500">
            Authentication is your DDISA token from <code>apes login</code>. As the owner you have implicit admin access.
          </p>
          <form class="flex flex-col sm:flex-row gap-2 mb-4" @submit.prevent="onGrant">
            <UInput v-model="grantDelegate" type="email" placeholder="who@example.com" class="flex-1" />
            <USelect
              v-model="grantAccess"
              :items="[{ label: 'git:read', value: 'read' }, { label: 'git:write', value: 'write' }, { label: 'git:admin', value: 'admin' }]"
              class="sm:w-36"
            />
            <UButton type="submit" color="primary" :loading="granting" :disabled="!grantDelegate.trim()">
              Grant
            </UButton>
          </form>

          <p v-if="repo.grants.length === 0" class="text-zinc-500">
            No grants — only you can access this repo.
          </p>
          <ul v-else class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
            <li
              v-for="grant in repo.grants"
              :key="grant.id"
              class="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div class="min-w-0">
                <span class="font-mono text-sm">{{ grant.delegate }}</span>
                <UBadge
                  :color="grant.status === 'approved' ? 'primary' : 'neutral'"
                  variant="subtle"
                  class="ml-2"
                >
                  git:{{ grant.access }} · {{ grant.status }}
                </UBadge>
              </div>
              <UButton
                v-if="grant.status === 'approved'"
                size="xs"
                color="error"
                variant="soft"
                @click="onRevoke(grant.id)"
              >
                Revoke
              </UButton>
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-xl font-semibold mb-3">
            Push mirrors
          </h2>
          <p class="mb-4 text-sm text-zinc-500">
            Pushes and merges are replicated to these forges, ref by ref. A scan every five minutes recovers missed events. Without
            <code>--force</code>: if the far side has commits this repo does not, the push
            fails and is listed below instead of overwriting them. Use a token scoped to
            the one repository over there.
          </p>
          <form class="flex flex-col gap-2 mb-4" @submit.prevent="onAddMirror">
            <UInput v-model="mirrorUrl" type="url" class="w-full" placeholder="https://git.example/owner/repo.git" />
            <div class="flex flex-col sm:flex-row gap-2">
              <UInput v-model="mirrorUser" class="w-full sm:w-52" placeholder="username" />
              <UInput v-model="mirrorToken" type="password" class="w-full flex-1" placeholder="token (write access)" autocomplete="off" />
            </div>
            <UButton
              class="self-start"
              type="submit"
              color="primary"
              :loading="addingMirror"
              :disabled="!mirrorUrl.trim() || !mirrorUser.trim() || !mirrorToken"
            >
              Add mirror
            </UButton>
          </form>

          <p v-if="mirrors.length === 0" class="text-zinc-500">
            No mirrors — pushes stay here.
          </p>
          <ul v-else class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
            <li
              v-for="mirror in mirrors"
              :key="mirror.id"
              class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span class="font-mono text-sm break-all min-w-0">{{ mirror.username }}@{{ mirror.url }}</span>
              <UButton size="xs" color="error" variant="soft" @click="onDeleteMirror(mirror.id)">
                Delete
              </UButton>
            </li>
          </ul>

          <div v-if="mirrors.length" class="mt-4 flex gap-2">
            <UButton size="xs" :loading="reconciling" @click="onReconcile">
              Reconcile now
            </UButton>
            <UButton size="xs" variant="soft" @click="loadMirrors">
              Refresh status
            </UButton>
          </div>
          <ul class="mt-4 space-y-3 text-xs">
            <li v-for="state in mirrorStates" :key="`${state.mirrorId}:${state.ref}`" class="border border-zinc-800 rounded p-3 break-all">
              <p class="font-mono">
                {{ state.ref }} · {{ mirrors.find(m => m.id === state.mirrorId)?.url }}
              </p>
              <p>Source: {{ state.sourceSha ?? 'deleted' }} · Target: {{ state.targetSha ?? 'absent or unavailable' }}</p>
              <p>Checked: {{ new Date(state.checkedAt * 1000).toLocaleString() }} · Last synchronized: {{ state.syncedAt ? new Date(state.syncedAt * 1000).toLocaleString() : 'never' }}</p>
              <p :class="state.error ? 'text-red-400' : 'text-emerald-500'">
                {{ state.error ?? 'Synchronized' }}
              </p>
            </li>
          </ul>

          <h3 class="text-sm font-semibold mt-6 mb-2 text-zinc-300">
            Recent pushes
          </h3>
          <p v-if="mirrorPushes.length === 0" class="text-zinc-500 text-sm">
            Nothing mirrored yet.
          </p>
          <ul v-else class="text-xs font-mono space-y-1 text-zinc-400">
            <li v-for="push in mirrorPushes" :key="push.id" class="flex flex-wrap gap-2">
              <UIcon
                :name="push.ok ? 'i-lucide-check' : 'i-lucide-x'"
                :class="push.ok ? 'size-4 text-emerald-500 shrink-0' : 'size-4 text-red-500 shrink-0'"
              />
              <span class="break-all">{{ push.ref }}</span>
              <span class="text-zinc-600">{{ push.sha.slice(0, 8) }} · {{ push.durationMs }}ms</span>
              <span v-if="push.error" class="text-red-400 break-all">{{ push.error.split('\n')[0] }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 class="text-xl font-semibold mb-3">
            Webhooks
          </h2>
          <p class="mb-4 text-sm text-zinc-500">
            Every push posts a signed event to these endpoints. The consumer verifies
            <code>X-Ape-Signature-256</code> with the secret, and signs its commit-status
            reports back with the same secret.
          </p>
          <form class="flex flex-col sm:flex-row gap-2 mb-4" @submit.prevent="onSubscribe">
            <UInput v-model="hookUrl" type="url" placeholder="https://consumer.example/hook" class="flex-1" />
            <UButton type="submit" color="primary" :loading="subscribing" :disabled="!hookUrl.trim()">
              Subscribe
            </UButton>
          </form>

          <UAlert
            v-if="newSecret"
            color="warning"
            variant="subtle"
            class="mb-4"
            title="Secret — shown once"
            :description="newSecret"
            :close="true"
            @update:open="newSecret = ''"
          />

          <p v-if="repo.webhooks.length === 0" class="text-zinc-500">
            No webhooks — pushes fire nothing.
          </p>
          <ul v-else class="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
            <li
              v-for="hook in repo.webhooks"
              :key="hook.id"
              class="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span class="font-mono text-sm truncate">{{ hook.url }}</span>
              <UButton size="xs" color="error" variant="soft" @click="onDeleteHook(hook.id)">
                Delete
              </UButton>
            </li>
          </ul>

          <h3 class="text-sm font-semibold mt-6 mb-2 text-zinc-300">
            Recent deliveries
          </h3>
          <p v-if="repo.deliveries.length === 0" class="text-zinc-500 text-sm">
            Nothing delivered yet.
          </p>
          <ul v-else class="text-xs font-mono space-y-1 text-zinc-400">
            <li v-for="delivery in repo.deliveries" :key="delivery.id" class="flex gap-2">
              <UIcon
                :name="delivery.statusCode && delivery.statusCode < 400 ? 'i-lucide-check' : 'i-lucide-x'"
                :class="delivery.statusCode && delivery.statusCode < 400 ? 'text-emerald-500' : 'text-red-500'"
                class="size-3.5 shrink-0 mt-0.5"
              />
              <span class="truncate">{{ deliveryLabel(delivery) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
