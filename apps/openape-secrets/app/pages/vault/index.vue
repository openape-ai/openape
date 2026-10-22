<script setup lang="ts">
import type { VaultView } from '~/utils/vault-client'
import { onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { addPasskey, flowError, loadVault, testUnlock } from '~/utils/vault-client'

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const vault = ref<VaultView | null>(null)
const unavailable = ref('')
const busy = ref<'unlock' | 'add' | null>(null)
const error = ref('')
const notice = ref('')

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const added = (sec: number) => dateFormat.format(new Date(sec * 1000))

async function refresh() {
  vault.value = await loadVault().catch((err: { statusCode?: number }) => {
    unavailable.value = err.statusCode === 404 ? 'The vault is not available here yet.' : flowError(err)
    return null
  })
}

async function run(kind: 'unlock' | 'add', action: () => Promise<string>) {
  busy.value = kind
  error.value = ''
  notice.value = ''
  try {
    notice.value = await action()
  }
  catch (err) {
    error.value = flowError(err)
  }
  finally {
    busy.value = null
  }
}

const unlock = () => run('unlock', async () => `Unlocked with ${await testUnlock(vault.value!)}, and locked again.`)
function add() {
  return run('add', async () => {
    await addPasskey(vault.value!)
    await refresh()
    return 'Passkey added. Either one can now unlock your vault.'
  })
}

onMounted(async () => {
  await fetchUser()
  if (user.value) await refresh()
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <VaultHeader :email="user?.sub" />

    <main class="mx-auto flex max-w-5xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-8">
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
        <div class="flex flex-wrap items-end justify-between gap-4">
          <h1 class="text-[34px] font-semibold leading-tight tracking-tight">
            Your vault
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
          <section aria-labelledby="passkeys-title" class="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-[20px] border border-default bg-muted p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="passkeys-title" class="text-[20px] font-semibold tracking-tight">
                Passkeys that open it
              </h2>
              <UButton color="neutral" variant="subtle" icon="i-lucide-plus" :loading="busy === 'add'" :disabled="!!busy" @click="add">
                Add a passkey
              </UButton>
            </div>
            <ul class="flex flex-col">
              <li v-for="c in vault.credentials" :key="c.id" class="flex items-center gap-3 border-t border-default py-3 first:border-t-0">
                <span class="inline-flex size-10 items-center justify-center rounded-xl bg-[#16344A] text-sky-300" aria-hidden="true">
                  <UIcon :name="c.label === 'Security key' ? 'i-lucide-usb' : 'i-lucide-key-round'" class="size-5" />
                </span>
                <div class="min-w-0">
                  <div class="font-medium">
                    {{ c.label || 'Passkey' }}
                  </div>
                  <div class="text-sm text-dimmed">
                    Added {{ added(c.created_at) }}
                  </div>
                </div>
              </li>
            </ul>
          </section>

          <aside class="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            <div class="flex flex-col gap-3 rounded-[20px] border border-default bg-muted p-5">
              <h2 class="text-[15px] font-semibold">
                Check your passkey
              </h2>
              <p class="text-sm text-muted">
                Opens your vault on this device and locks it again right away. Nothing is sent anywhere.
              </p>
              <UButton icon="i-lucide-key-round" :loading="busy === 'unlock'" :disabled="!!busy" class="self-start" @click="unlock">
                Test unlock
              </UButton>
            </div>
            <div class="flex flex-col gap-2 rounded-[20px] border border-default p-5">
              <h2 class="text-[15px] font-semibold">
                Recovery kit
              </h2>
              <p class="text-sm text-muted">
                {{ vault.has_recovery ? 'Saved when you set up the vault. It replaces lost passkeys.' : 'This vault has no recovery kit.' }}
              </p>
              <NuxtLink v-if="vault.has_recovery" to="/vault/recover" class="text-sm font-medium text-sky-300 hover:text-sky-200">
                Lost your passkeys? Use the recovery kit
              </NuxtLink>
            </div>
          </aside>
        </div>
      </template>
    </main>
  </div>
</template>
