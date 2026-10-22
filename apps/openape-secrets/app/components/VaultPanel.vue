<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { DeliveryContext, Envelope, SecretPayload, WrappedKey } from '@openape/ape-secrets/vault'
import type { Approval, Consumer, Request, Secret, Vault } from '../../shared/vault-types'
import type { Ceremony } from '../utils/vault-browser'
import type { Recovery } from '../utils/vault-engine'
import { authenticate, register, vaultWorker } from '../utils/vault-browser'

interface View {
  owner: string
  vault: Vault | null
  credentials: { id: string, input: string, wrapper: WrappedKey }[]
  secrets: Secret[]
  consumers: Consumer[]
  registeredConsumers: { id: string, name: string, fingerprint: string, collectors: string[] }[]
  requests: Request[]
  approvals: Omit<Approval, 'envelope'>[]
}
interface ActionCeremony extends Ceremony {
  wrapper: WrappedKey
  action: { type: string, secretId: string, version: number, descriptor: DeliveryContext }
}
const state = ref<View>()
const busy = ref(false)
const error = ref('')
const message = ref('')
const credentialId = ref('')
const alias = ref('')
const value = ref('')
const editId = ref('')
const revealed = ref('')
let revealTimer: ReturnType<typeof setTimeout> | undefined
const recoveryCode = ref('')
const recoverySaved = ref(false)
const modes = reactive<Record<string, 'once' | 'timed' | 'standing'>>({})
const durations = reactive<Record<string, number>>({})
const directValues = reactive<Record<string, string>>({})
const collectors = reactive<Record<string, string>>({})
let pendingSetup: { challengeId: string, response: unknown, wrapper: WrappedKey, recovery: Recovery } | undefined
function api<T>(path: string, body?: object, method: 'GET' | 'POST' | 'DELETE' = body ? 'POST' : 'GET') {
  return $fetch<T>(`/api/v2/${path}`, { method, body })
}
async function refresh() {
  state.value = await api<View>('vault')
  if (!state.value.credentials.some(c => c.id === credentialId.value)) credentialId.value = state.value.credentials[0]?.id ?? ''
}
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await fn() }
  catch (e) { error.value = e instanceof Error ? e.message : 'Operation failed' }
  finally { busy.value = false; value.value = ''; for (const id of Object.keys(directValues)) delete directValues[id] }
}
function hideValues() {
  revealed.value = ''; value.value = ''; recoveryCode.value = ''; pendingSetup = undefined
  for (const id of Object.keys(directValues)) delete directValues[id]
}
onMounted(() => { window.addEventListener('pagehide', hideValues); run(refresh) })
onBeforeUnmount(() => { window.removeEventListener('pagehide', hideValues); pendingSetup = undefined; recoveryCode.value = ''; value.value = ''; revealed.value = ''; clearTimeout(revealTimer) })

async function setup() {
  const worker = vaultWorker()
  try {
    const start = await api<Ceremony>('setup/options', {})
    const c = await api<Ceremony>('setup/register', { challengeId: start.challengeId, response: await register(start.options) })
    const proof = await authenticate(c)
    const created = await worker.call<{ code: string, wrapper: WrappedKey, recovery: Recovery }>({ type: 'setup', owner: state.value!.owner, credentialId: c.credentialId, prf: proof.prf })
    pendingSetup = { challengeId: c.challengeId, response: proof.response, wrapper: created.wrapper, recovery: created.recovery }
    recoveryCode.value = created.code
    recoverySaved.value = false
  }
  finally { worker.dispose() }
}
async function finishSetup() {
  if (!recoverySaved.value || !pendingSetup) return
  await api('setup/confirm', pendingSetup)
  pendingSetup = undefined; recoveryCode.value = ''
  await refresh(); message.value = 'Vault created. Your recovery code is required if all passkeys are lost.'
}
async function action(input: object, perform?: (worker: ReturnType<typeof vaultWorker>, c: ActionCeremony) => Promise<object>) {
  const worker = vaultWorker()
  try {
    const c = await api<ActionCeremony>('actions/options', { credentialId: credentialId.value, action: input })
    const proof = await authenticate(c)
    await worker.call({ type: 'unlock', owner: state.value!.owner, credentialId: c.credentialId, prf: proof.prf, wrapper: c.wrapper })
    const extra = perform ? await perform(worker, c) : {}
    const result = await api<Ceremony>('actions/commit', { challengeId: c.challengeId, response: proof.response, ...extra })
    if ('type' in input && input.type === 'enroll') await enroll(worker, result)
    await refresh()
    message.value = 'Operation completed.'
  }
  finally { worker.dispose() }
}
async function reveal(secret: Secret) {
  let plaintext = ''
  await action({ type: 'unlock' }, async (worker) => {
    plaintext = await worker.call<string>({ type: 'read', owner: state.value!.owner, secretId: secret.id, version: secret.version, payload: secret.payload })
    return {}
  })
  revealed.value = plaintext
  clearTimeout(revealTimer)
  revealTimer = setTimeout(() => { revealed.value = '' }, 30000)
}
async function save() {
  await action({ type: 'save', alias: alias.value, ...(editId.value ? { secretId: editId.value } : {}) }, async (worker, c) => ({ payload: await worker.call<SecretPayload>({ type: 'save', owner: state.value!.owner, secretId: c.action.secretId, version: c.action.version, value: value.value }) }))
  alias.value = ''; editId.value = ''
}
async function approve(request: Request) {
  await action({ type: 'approve', requestId: request.id, mode: modes[request.id] ?? 'once', duration: durations[request.id] ?? 900 }, async (worker, c) => {
    const consumer = state.value!.consumers.find(v => v.id === request.consumerId)!
    const secret = state.value!.secrets.find(v => v.id === request.secretId && v.version === request.version)
    return { envelope: await worker.call<Envelope>({ type: 'seal', key: consumer.publicKey, descriptor: c.action.descriptor, ...(secret ? { payload: secret.payload } : { value: directValues[request.id] ?? '' }) }) }
  })
}
async function enroll(worker: ReturnType<typeof vaultWorker>, start: Ceremony) {
  const c = await api<Ceremony>('credentials/register', { challengeId: start.challengeId, response: await register(start.options) })
  const proof = await authenticate(c)
  const wrapper = await worker.call<WrappedKey>({ type: 'wrap', owner: state.value!.owner, credentialId: c.credentialId, prf: proof.prf })
  await api('credentials/confirm', { challengeId: c.challengeId, response: proof.response, wrapper })
}
async function recover() {
  const worker = vaultWorker()
  try {
    const start = await api<{ vault: Vault, challenge: string, challengeId: string }>('recovery/options', {})
    const v = start.vault
    const signature = await worker.call<string>({ type: 'recover', owner: state.value!.owner, code: recoveryCode.value.trim(), recovery: { id: v.recoveryId, publicKey: v.recoveryPublicKey, wrapper: v.recoveryWrapper, privateKey: v.recoveryPrivateKey }, challengeId: start.challengeId, challenge: start.challenge })
    recoveryCode.value = ''
    await enroll(worker, await api<Ceremony>('recovery/commit', { challengeId: start.challengeId, signature }))
    await refresh(); message.value = 'Replacement passkey added. Remove any lost passkeys below.'
  }
  finally { recoveryCode.value = ''; worker.dispose() }
}
async function remove(path: string) { await api(path, undefined, 'DELETE'); await refresh() }
async function post(path: string) { await api(path, {}); await refresh() }
</script>

<template>
  <main class="mx-auto max-w-3xl p-6 space-y-8">
    <h1 class="text-2xl font-semibold">
      Secrets vault
    </h1>
    <p>Your passkey opens the vault here. Approved secrets are encrypted for the receiving machine. No request traffic is proxied.</p>
    <p v-if="error" role="alert" class="text-red-400 break-words">
      {{ error }}
    </p>
    <p v-if="message" role="status">
      {{ message }}
    </p>
    <p v-if="busy" role="status">
      Working… Complete the passkey prompt on your device.
    </p>
    <template v-if="state">
      <p>Signed in as {{ state.owner }}</p>
      <fieldset v-if="!state.vault" :disabled="busy" class="space-y-4">
        <button v-if="!recoveryCode" class="underline" @click="run(setup)">
          Create vault with a PRF passkey
        </button>
        <template v-else>
          <p>Save this recovery code offline now. It will not be shown again. Finish within five minutes.</p>
          <textarea :value="recoveryCode" readonly aria-label="Recovery code" class="w-full bg-zinc-900 p-3" />
          <label class="block"><input v-model="recoverySaved" type="checkbox"> I saved the recovery code outside this browser.</label>
          <button :disabled="!recoverySaved" class="underline" @click="run(finishSetup)">
            Finish setup
          </button>
          <button class="underline ml-4" @click="recoveryCode = ''; pendingSetup = undefined">
            Start over
          </button>
        </template>
      </fieldset>
      <fieldset v-else :disabled="busy" class="space-y-8">
        <section class="space-y-3">
          <h2 class="text-xl">
            Passkeys
          </h2>
          <label class="block">Passkey for this operation <select v-model="credentialId" class="w-full bg-zinc-900 p-2"><option v-for="c in state.credentials" :key="c.id" :value="c.id">{{ c.id }}</option></select></label>
          <button class="underline" @click="run(() => action({ type: 'enroll' }))">
            Add another passkey
          </button>
          <button :disabled="state.credentials.length < 2" class="underline ml-4" @click="run(() => remove(`credentials/${credentialId}`))">
            Remove selected passkey
          </button>
        </section>
        <section class="space-y-3">
          <h2 class="text-xl">
            Stored secrets
          </h2>
          <ul class="space-y-2">
            <li v-for="s in state.secrets" :key="s.id">
              {{ s.alias }} · version {{ s.version }} <button class="underline ml-4" @click="run(() => reveal(s))">
                Reveal for 30 seconds
              </button><button class="underline ml-4" @click="editId = s.id; alias = s.alias; value = ''">
                Replace
              </button><button class="underline ml-4" @click="run(() => remove(`secrets/${s.id}`))">
                Delete
              </button>
            </li>
          </ul>
          <pre v-if="revealed" class="whitespace-pre-wrap break-all bg-zinc-900 p-3">{{ revealed }}</pre>
          <button v-if="revealed" class="underline" @click="revealed = ''">
            Hide value
          </button>
          <form class="space-y-2" @submit.prevent="run(save)">
            <label class="block">Name <input v-model="alias" required maxlength="120" class="w-full bg-zinc-900 p-2"></label>
            <label class="block">New value <input v-model="value" required type="password" autocomplete="off" class="w-full bg-zinc-900 p-2"></label>
            <button class="underline">
              {{ editId ? 'Replace and invalidate existing releases' : 'Encrypt and save' }}
            </button>
            <button v-if="editId" type="button" class="underline ml-4" @click="editId = ''; alias = ''; value = ''">
              Cancel replacement
            </button>
          </form>
        </section>
        <section class="space-y-3">
          <h2 class="text-xl">
            Receiving machines
          </h2>
          <p>Register a machine with <code>ape-secrets keygen</code>, then confirm its collector and public key here.</p>
          <div v-for="c in state.registeredConsumers" :key="c.id" class="border border-zinc-700 p-3 space-y-2">
            <p>{{ c.name }} · {{ c.id }}</p>
            <p class="break-all">
              Public key fingerprint (SHA-256): {{ c.fingerprint }}
            </p>
            <label class="block">Collector <select v-model="collectors[c.id]" class="bg-zinc-900 p-2"><option v-for="identity in c.collectors" :key="identity" :value="identity">{{ identity }}</option></select></label>
            <button :disabled="!collectors[c.id]" class="underline" @click="run(() => action({ type: 'bind', consumerId: c.id, collector: collectors[c.id] }))">
              Confirm recipient with passkey
            </button>
          </div>
          <div v-for="c in state.consumers.filter(c => !c.disabled)" :key="c.id" class="break-all">
            <p>{{ c.name }} · collector {{ c.collector }} · SHA-256 {{ c.fingerprint }}</p>
            <button class="underline" @click="run(() => remove(`consumers/${c.id}`))">
              Disable recipient and releases
            </button>
          </div>
        </section>
        <section class="space-y-4">
          <h2 class="text-xl">
            Requests
          </h2>
          <button class="underline" @click="run(refresh)">
            Refresh requests
          </button>
          <article v-for="r in state.requests.filter(r => r.status === 'pending' && r.expiresAt > Date.now())" :key="r.id" class="border border-zinc-700 p-4 space-y-3">
            <p>{{ state.secrets.find(s => s.id === r.secretId)?.alias ?? r.secretId.slice(4) }} · version {{ r.version || 'direct input' }}</p>
            <p class="break-all">
              {{ r.requester }} → {{ r.consumerId }}<br>Recipient fingerprint: {{ r.fingerprint }}
            </p>
            <p>Agent-supplied reason: {{ r.purpose }}</p>
            <label v-if="r.version === 0" class="block">Value for this request <input v-model="directValues[r.id]" type="password" autocomplete="off" class="w-full bg-zinc-900 p-2"></label>
            <label class="block">Release <select :value="modes[r.id] ?? 'once'" class="bg-zinc-900 p-2" @change="modes[r.id] = ($event.target as HTMLSelectElement).value as 'once' | 'timed' | 'standing'"><option value="once">Once (collect within 24 hours)</option><option value="timed">Time limited</option><option value="standing">Until revoked</option></select></label>
            <label v-if="modes[r.id] === 'timed'" class="block">Seconds (60–604800) <input v-model.number="durations[r.id]" type="number" min="60" max="604800" placeholder="900" class="bg-zinc-900 p-2"></label>
            <p>Revoking or expiry stops future retrieval. An already received value cannot be recalled.</p>
            <button :disabled="r.version === 0 && !directValues[r.id]" class="underline" @click="run(() => approve(r))">
              Release with passkey
            </button>
            <button class="underline ml-4" @click="run(() => post(`requests/${r.id}/deny`))">
              Deny
            </button>
          </article>
        </section>
        <section class="space-y-3">
          <h2 class="text-xl">
            Releases
          </h2>
          <div v-for="a in state.approvals" :key="a.id" class="break-words">
            <p>{{ a.descriptor.requester }} · {{ a.descriptor.mode }} · {{ a.status }} · {{ a.descriptor.expiresAt ? new Date(a.descriptor.expiresAt).toLocaleString() : 'No expiry' }}</p>
            <button v-if="a.status === 'active'" class="underline" @click="run(() => post(`approvals/${a.id}/revoke`))">
              Revoke
            </button>
          </div>
        </section>
        <details class="space-y-3">
          <summary>Recover with offline code</summary>
          <label class="block">Recovery code <input v-model="recoveryCode" type="password" autocomplete="off" class="w-full bg-zinc-900 p-2"></label>
          <button :disabled="!recoveryCode" class="underline" @click="run(recover)">
            Recover and add a replacement passkey
          </button>
        </details>
      </fieldset>
    </template>
  </main>
</template>
