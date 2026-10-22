<script setup lang="ts">
import type { SecretDetail, SecretSummary, SecretType, VaultView } from '~/utils/vault-client'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { deleteSecret, flowError, listSecrets, loadVault, readSecret, revealSecret, saveSecret, SECRET_TYPE_LABELS } from '~/utils/vault-client'

const REVEAL_SECONDS = 30

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const unavailable = ref('')
const vault = ref<VaultView | null>(null)
const secrets = ref<SecretSummary[]>([])
const query = ref('')
const selected = ref<SecretDetail | null>(null)
const revealed = ref('')
const notice = ref('')
const error = ref('')
const busy = ref<'reveal' | 'save' | 'delete' | null>(null)
const editorOpen = ref(false)
const editorFor = ref<SecretDetail | null>(null)
const editorError = ref('')
const editor = ref<{ clear: () => void } | null>(null)
const deleteOpen = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? secrets.value.filter(s => s.alias.toLowerCase().includes(q)) : secrets.value
})

const thisYear = new Date().getFullYear()
function day(sec: number) {
  const date = new Date(sec * 1000)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() === thisYear ? {} : { year: 'numeric' }) })
}

const typeLabel = (type: string) => SECRET_TYPE_LABELS[type as SecretType] ?? type

const history = computed(() => {
  const versions = selected.value?.versions ?? []
  return versions.map((v, i) => ({
    version: v.version,
    note: i === 0 ? `Current, saved ${day(v.created_at)}` : `Replaced ${day(versions[i - 1]!.created_at)}`, // versions are newest first
  }))
})

function hide() {
  revealed.value = ''
  clearTimeout(hideTimer)
}

async function refresh(selectId?: string) {
  secrets.value = await listSecrets()
  const id = selectId ?? selected.value?.id
  selected.value = id && secrets.value.some(s => s.id === id) ? await readSecret(id) : null
}

async function select(secret: SecretSummary) {
  hide()
  error.value = ''
  selected.value = await readSecret(secret.id)
}

async function run(kind: 'reveal' | 'save' | 'delete', action: () => Promise<void>, onError = (message: string) => { error.value = message }) {
  busy.value = kind
  error.value = ''
  notice.value = ''
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

function reveal() {
  return run('reveal', async () => {
    revealed.value = await revealSecret(vault.value!, selected.value!)
    hideTimer = setTimeout(hide, REVEAL_SECONDS * 1000)
  })
}

async function copy() {
  await navigator.clipboard.writeText(revealed.value)
  notice.value = `${selected.value?.alias} copied.`
}

function openEditor(secret: SecretDetail | null) {
  editorFor.value = secret
  editorError.value = ''
  editorOpen.value = true
}

function save(input: { alias: string, type: SecretType, value: string }) {
  return run('save', async () => {
    const saved = await saveSecret(vault.value!, { secretId: editorFor.value?.id, alias: input.alias, type: input.type, value: input.value })
    editor.value?.clear()
    editorOpen.value = false
    hide()
    await refresh(saved.secret_id)
    notice.value = saved.version === 1 ? `${input.alias} saved.` : `Version ${saved.version} of ${selected.value?.alias} saved.`
  }, (message) => { editorError.value = message })
}

function remove() {
  return run('delete', async () => {
    const alias = selected.value!.alias
    await deleteSecret(vault.value!, selected.value!.id)
    deleteOpen.value = false
    hide()
    selected.value = null
    await refresh()
    notice.value = `${alias} deleted.`
  })
}

onMounted(async () => {
  await fetchUser()
  if (user.value) {
    vault.value = await loadVault().catch((err: { statusCode?: number }) => {
      unavailable.value = err.statusCode === 404 ? 'The vault is not available here yet.' : flowError(err)
      return null
    })
    if (vault.value?.id) await refresh()
  }
  ready.value = true
})

onBeforeUnmount(hide)
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <VaultHeader :email="user?.sub" :nav="!!vault?.id" />

    <main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-8">
      <OpenApeAuth v-if="ready && !user" subtitle="Sign in to open your vault." />

      <UAlert v-else-if="ready && unavailable" color="neutral" variant="subtle" :title="unavailable" />

      <section v-else-if="ready && vault && !vault.id" class="flex max-w-2xl flex-col items-start gap-4 rounded-[20px] border border-default bg-muted p-7">
        <h1 class="text-[28px] font-semibold leading-tight tracking-tight">
          You don’t have a vault yet
        </h1>
        <p class="text-muted">
          Keep secrets in a vault only your passkey opens, and hand them to your machines when you approve it.
        </p>
        <UButton size="xl" to="/vault/setup" icon="i-lucide-shield-plus">
          Set up your vault
        </UButton>
      </section>

      <template v-else-if="ready && vault?.id">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="flex-1 text-[28px] font-semibold leading-tight tracking-tight">
            Your secrets
          </h1>
          <span class="inline-flex items-center gap-1.5 text-sm text-muted">
            <UIcon name="i-lucide-lock" class="size-4" />
            Locked
          </span>
        </div>

        <p v-if="notice" role="status" class="-mt-4 flex items-center gap-2 text-brass">
          <UIcon name="i-lucide-circle-check" class="size-5 shrink-0" />
          {{ notice }}
        </p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="-mt-4" />

        <div class="flex flex-wrap items-start gap-6">
          <section aria-labelledby="list-title" class="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
            <h2 id="list-title" class="sr-only">
              Secrets
            </h2>
            <div class="flex flex-wrap items-center gap-3">
              <UInput v-model="query" icon="i-lucide-search" placeholder="Search secrets" aria-label="Search secrets" class="min-w-0 flex-[1_1_220px]" />
              <UButton color="neutral" variant="subtle" icon="i-lucide-plus" @click="openEditor(null)">
                Add secret
              </UButton>
            </div>

            <div v-if="!secrets.length" class="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-accented p-6">
              <p class="font-medium">
                Your vault is empty
              </p>
              <p class="text-sm text-muted">
                Add the passwords, tokens and keys your machines need. Each one is encrypted here, before it leaves this device.
              </p>
              <UButton icon="i-lucide-plus" @click="openEditor(null)">
                Add your first secret
              </UButton>
            </div>

            <div v-else class="rounded-2xl border border-default bg-muted p-1.5">
              <table class="w-full table-fixed border-separate border-spacing-0 text-left">
                <thead>
                  <tr class="text-[13px] text-dimmed">
                    <th scope="col" class="px-3.5 pb-2 pt-2.5 font-normal">
                      Name
                    </th>
                    <th scope="col" class="w-32 px-3 pb-2 pt-2.5 font-normal">
                      Type
                    </th>
                    <th scope="col" class="hidden w-20 px-3 pb-2 pt-2.5 font-normal sm:table-cell">
                      Version
                    </th>
                    <th scope="col" class="hidden w-24 px-3 pb-2 pt-2.5 font-normal sm:table-cell">
                      Changed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="s in shown"
                    :key="s.id"
                    class="cursor-pointer"
                    :class="selected?.id === s.id ? 'bg-elevated' : 'hover:bg-elevated/50'"
                    @click="select(s)"
                  >
                    <td class="rounded-l-[10px] px-3.5 py-3">
                      <button type="button" class="block max-w-full truncate text-left font-mono text-sm font-medium" :aria-pressed="selected?.id === s.id" @click.stop="select(s)">
                        {{ s.alias }}
                      </button>
                    </td>
                    <td class="px-3 py-3 text-sm text-muted max-sm:rounded-r-[10px]">
                      {{ typeLabel(s.type) }}
                    </td>
                    <td class="hidden px-3 py-3 text-sm text-muted sm:table-cell">
                      v{{ s.version }}
                    </td>
                    <td class="hidden rounded-r-[10px] px-3 py-3 text-sm text-muted sm:table-cell">
                      {{ day(s.updated_at) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!shown.length" class="px-3.5 py-4 text-sm text-muted">
                No secret matches “{{ query }}”.
              </p>
            </div>
          </section>

          <aside v-if="selected" aria-labelledby="detail-title" class="flex min-w-0 flex-[1_1_360px] flex-col gap-6 rounded-[20px] border border-default bg-muted p-6">
            <div class="flex flex-col gap-1">
              <h2 id="detail-title" class="break-all font-mono text-[19px] font-medium tracking-tight">
                {{ selected.alias }}
              </h2>
              <span class="text-sm text-muted">{{ typeLabel(selected.type) }}, version {{ selected.version }}</span>
            </div>

            <div class="flex flex-col gap-2.5 rounded-[14px] bg-default p-4">
              <span class="text-[13px] text-dimmed">Value</span>
              <template v-if="revealed">
                <span class="whitespace-pre-wrap break-all font-mono text-[15px]">{{ revealed }}</span>
                <div class="flex flex-wrap gap-2">
                  <UButton color="neutral" variant="subtle" icon="i-lucide-copy" @click="copy">
                    Copy
                  </UButton>
                  <UButton color="neutral" variant="ghost" icon="i-lucide-eye-off" @click="hide">
                    Hide
                  </UButton>
                </div>
                <span class="text-xs text-dimmed">Hidden again after {{ REVEAL_SECONDS }} seconds.</span>
              </template>
              <template v-else>
                <span class="font-mono text-[15px] tracking-[0.12em] text-muted" aria-label="Hidden value">●●●●●●●●●●●●●●●●</span>
                <UButton variant="outline" icon="i-lucide-key-round" class="self-start" :loading="busy === 'reveal'" :disabled="!!busy" @click="reveal">
                  Show with passkey
                </UButton>
              </template>
            </div>

            <div class="flex flex-col gap-2.5">
              <h3 class="text-[15px] font-semibold">
                Versions
              </h3>
              <div v-for="v in history" :key="v.version" class="flex justify-between gap-3 text-sm">
                <span class="font-medium">Version {{ v.version }}</span>
                <span class="text-dimmed">{{ v.note }}</span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2.5">
              <UButton color="neutral" variant="subtle" size="lg" :disabled="!!busy" @click="openEditor(selected)">
                Save a new version
              </UButton>
              <UButton color="error" variant="ghost" size="lg" :disabled="!!busy" @click="deleteOpen = true">
                Delete secret
              </UButton>
            </div>
          </aside>
        </div>

        <SecretEditor ref="editor" v-model:open="editorOpen" :secret="editorFor" :busy="busy === 'save'" :error="editorError" @save="save" />

        <UModal v-model:open="deleteOpen" :title="`Delete ${selected?.alias}?`" description="It leaves your vault for good. Values a machine already collected stay on that machine.">
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="deleteOpen = false">
                Cancel
              </UButton>
              <UButton color="error" icon="i-lucide-key-round" :loading="busy === 'delete'" @click="remove">
                Delete with passkey
              </UButton>
            </div>
          </template>
        </UModal>
      </template>
    </main>
  </div>
</template>
