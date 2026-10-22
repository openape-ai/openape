<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useOpenApeAuth } from '#imports'
import { addPasskey, flowError, loadVault, prepareVault } from '~/utils/vault-client'

type Prepared = Awaited<ReturnType<typeof prepareVault>>

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const step = ref<1 | 2 | 3>(1)
const busy = ref(false)
const error = ref('')
const prepared = ref<Prepared | null>(null)
const label = ref('')
const stored = ref(false)
const copied = ref(false)

const groups = computed(() => prepared.value?.code.split(' ') ?? [])
const steps = computed(() => [
  { n: 1, label: 'Create a passkey' },
  { n: 2, label: 'Save your recovery kit' },
  { n: 3, label: 'Add a second passkey' },
].map(s => ({ ...s, done: s.n < step.value, current: s.n === step.value })))

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  }
  catch (err) {
    error.value = flowError(err)
  }
  finally {
    busy.value = false
  }
}

function createPasskey() {
  return run(async () => {
    prepared.value = await prepareVault()
    label.value = prepared.value.label
    step.value = 2
  })
}

function saveVault() {
  return run(async () => {
    await prepared.value!.commit() // only reachable from step 2, after prepareVault
    prepared.value = null
    step.value = 3
  })
}

function addSecond() {
  return run(async () => {
    await addPasskey(await loadVault())
    await navigateTo('/vault')
  })
}

async function copyCode() {
  await navigator.clipboard.writeText(prepared.value?.code ?? '')
  copied.value = true
}

function printKit() {
  window.print()
}

function downloadKit() {
  const text = `OpenApe Secrets recovery kit\n\nAccount: ${user.value?.sub ?? ''}\nRecovery code: ${prepared.value?.code ?? ''}\n\nKeep this outside your vault. It is the only way back in if you lose every passkey.\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'openape-secrets-recovery-kit.txt' })
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  await fetchUser()
  if (user.value) {
    const vault = await loadVault().catch(() => null)
    if (vault?.id) await navigateTo('/vault')
  }
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <VaultHeader :email="user?.sub" />

    <main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-8">
      <OpenApeAuth v-if="ready && !user" subtitle="Sign in to set up your vault." />

      <template v-else-if="ready">
        <div class="flex max-w-2xl flex-col gap-2">
          <h1 class="text-[34px] font-semibold leading-tight tracking-tight">
            Set up your vault
          </h1>
          <p class="text-muted">
            Your vault opens only with your passkey. Nobody else can read what’s inside, OpenApe included.
          </p>
        </div>

        <ol aria-label="Setup steps" class="flex flex-wrap gap-x-7 gap-y-2">
          <li
            v-for="s in steps"
            :key="s.n"
            :aria-current="s.current ? 'step' : undefined"
            class="flex items-center gap-2.5"
            :class="s.current ? 'font-semibold text-default' : s.done ? 'text-muted' : 'text-dimmed'"
          >
            <span
              class="inline-flex size-7 items-center justify-center rounded-full text-sm"
              :class="s.done ? 'bg-primary text-[#06202F]' : s.current ? 'border-2 border-primary' : 'border-2 border-default'"
              aria-hidden="true"
            >
              <UIcon v-if="s.done" name="i-lucide-check" class="size-4" />
              <template v-else>{{ s.n }}</template>
            </span>
            {{ s.label }}<span v-if="s.done" class="sr-only"> (done)</span>
          </li>
        </ol>

        <div class="flex flex-wrap items-start gap-6">
          <section class="flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-[20px] border border-default bg-muted p-6 sm:p-7">
            <template v-if="step === 1">
              <div class="flex flex-col gap-1.5">
                <h2 class="text-[22px] font-semibold tracking-tight">
                  Create your vault passkey
                </h2>
                <p class="max-w-xl text-muted">
                  Your device asks you to confirm with Face ID, Touch ID or your PIN. Some devices ask once more to check that the passkey can keep your vault locked.
                </p>
              </div>
              <div>
                <UButton size="xl" icon="i-lucide-key-round" :loading="busy" @click="createPasskey">
                  Create passkey
                </UButton>
              </div>
            </template>

            <template v-else-if="step === 2">
              <div class="flex flex-col gap-1.5">
                <h2 class="text-[22px] font-semibold tracking-tight">
                  Save your recovery kit
                </h2>
                <p class="max-w-xl text-muted">
                  If you lose every passkey, this code is the only way back into your vault. Nobody can reset it for you. Keep it somewhere outside this vault: printed in a drawer, or in another password manager.
                </p>
              </div>

              <div
                class="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-x-2.5 gap-y-3 rounded-2xl border border-dashed border-accented bg-default p-5 text-center font-mono text-[19px] font-medium tracking-[0.08em]"
                aria-label="Recovery code"
              >
                <span v-for="(g, i) in groups" :key="i">{{ g }}</span>
              </div>

              <div class="flex flex-wrap gap-2.5">
                <UButton color="neutral" variant="subtle" size="lg" icon="i-lucide-download" @click="downloadKit">
                  Download
                </UButton>
                <UButton color="neutral" variant="subtle" size="lg" icon="i-lucide-printer" @click="printKit">
                  Print
                </UButton>
                <UButton color="neutral" variant="subtle" size="lg" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" @click="copyCode">
                  {{ copied ? 'Copied' : 'Copy code' }}
                </UButton>
              </div>

              <label class="flex cursor-pointer items-start gap-3 rounded-[14px] bg-default px-4 py-3.5">
                <UCheckbox v-model="stored" class="mt-0.5" />
                <span>I stored the recovery kit somewhere outside this vault.</span>
              </label>

              <div class="flex justify-end">
                <UButton size="xl" :color="stored ? 'primary' : 'neutral'" :variant="stored ? 'solid' : 'subtle'" :disabled="!stored" :loading="busy" @click="saveVault">
                  Continue
                </UButton>
              </div>
            </template>

            <template v-else>
              <div class="flex flex-col gap-1.5">
                <h2 class="text-[22px] font-semibold tracking-tight">
                  Add a second passkey
                </h2>
                <p class="max-w-xl text-muted">
                  A security key or another device. If this one gets lost, you still get in without the recovery kit. You’ll confirm with your current passkey first.
                </p>
              </div>
              <div class="flex flex-wrap gap-2.5">
                <UButton size="xl" icon="i-lucide-key-round" :loading="busy" @click="addSecond">
                  Add a passkey
                </UButton>
                <UButton size="xl" color="neutral" variant="ghost" to="/vault">
                  Skip for now
                </UButton>
              </div>
            </template>

            <UAlert v-if="error" color="error" variant="subtle" :title="error" />
          </section>

          <aside v-if="step > 1" class="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            <div class="flex flex-col gap-3 rounded-[20px] border border-default bg-muted p-5">
              <h2 class="text-[15px] font-semibold">
                Your passkey
              </h2>
              <div class="flex items-center gap-3">
                <span class="inline-flex size-10 items-center justify-center rounded-xl bg-[#16344A] text-sky-300" aria-hidden="true">
                  <UIcon name="i-lucide-key-round" class="size-5" />
                </span>
                <div>
                  <div class="font-medium">
                    {{ label }}
                  </div>
                  <div class="text-sm text-dimmed">
                    Can unlock your vault
                  </div>
                </div>
              </div>
              <p class="text-sm text-muted">
                We checked that before saving anything.
              </p>
            </div>
          </aside>
        </div>
      </template>
    </main>
  </div>
</template>
