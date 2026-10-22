<script setup lang="ts">
import { ref } from 'vue'
import { checkPrf } from '../utils/prf-check'

const busy = ref(false)
const result = ref('')
async function run() {
  busy.value = true; result.value = ''
  try { result.value = JSON.stringify(await checkPrf(), null, 2) }
  catch (e) { result.value = e instanceof Error ? e.message : 'PRF check failed' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="mx-auto max-w-2xl p-6 space-y-4">
    <h1 class="text-2xl">
      Passkey PRF compatibility check
    </h1>
    <p>This creates a temporary passkey for this origin and asks you to verify three times. Use the passkey provider you intend to use for your vault.</p>
    <p>The test checks user verification, stable PRF output and separate outputs for different inputs. Keys stay in this browser and are discarded. It does not create a vault or send results to a server.</p>
    <p>After the test, delete the “Temporary PRF compatibility test” passkey in your password manager. A successful localhost test must still be repeated on the production origin.</p>
    <button :disabled="busy" class="underline" @click="run">
      {{ busy ? 'Complete the passkey prompts…' : 'Start interactive check' }}
    </button>
    <pre v-if="result" role="status" class="whitespace-pre-wrap break-words bg-zinc-900 p-4">{{ result }}</pre>
  </main>
</template>
