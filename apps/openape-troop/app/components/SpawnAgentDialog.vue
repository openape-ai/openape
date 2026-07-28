<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface NestHost {
  host_id: string
  hostname: string
  version: string
  last_seen_at: number
}

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const hosts = ref<NestHost[]>([])
const hostsError = ref('')
const loadingHosts = ref(false)

async function loadHosts() {
  loadingHosts.value = true
  hostsError.value = ''
  try { hosts.value = await ($fetch as any)('/api/nest/hosts') }
  catch (err: any) {
    hostsError.value = err?.data?.statusMessage || err?.data?.message || err?.message || t('spawn.error.hostsLoadFailed')
  }
  finally {
    loadingHosts.value = false
  }
}

watch(open, (now) => { if (now) loadHosts() })

// One extensible spawn form — no modes. Every agent has a name and
// (optionally) a system prompt. A recipe is purely *additive*: an
// always-available collapsible section. Secrets is likewise always
// available. No special case.
//
// Curated recipe index — pick from the list or choose "Custom…" and
// paste any github.com/<owner>/<name>@<ref>. `caps` lets the recipe
// pre-declare which secrets to add; if a recipe doesn't, the Help
// button points at its repo where the README documents them.
interface RecipeIndexEntry { id: string, label: string, repo_ref: string, repo_url: string, hintKey: string, caps: string[] }
const RECIPE_NONE = '__none__'
const RECIPE_CUSTOM = '__custom__'
const RECIPE_INDEX: RecipeIndexEntry[] = [
  {
    id: 'bluesky-summary',
    label: 'Bluesky feed summary',
    repo_ref: 'github.com/openape-ai/agent-catalog/bluesky-summary@v0.1.0',
    repo_url: 'https://github.com/openape-ai/agent-catalog/tree/main/bluesky-summary',
    hintKey: 'spawn.recipe.entries.blueskySummary.hint',
    caps: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
  },
  {
    id: 'ceo',
    label: 'Org Operator',
    repo_ref: 'github.com/openape-ai/agent-catalog/ceo@v0.1.0',
    repo_url: 'https://github.com/openape-ai/agent-catalog/tree/main/ceo',
    hintKey: 'spawn.recipe.entries.ceo.hint',
    caps: ['ORG_API_TOKEN'],
  },
]
const selectedRecipe = ref<string>(RECIPE_NONE)
const recipeForm = ref({ repo_ref: '', params: '' })

// Free-text persona presets — fill the system-prompt textarea. With a
// recipe this rides along as the additive user_addendum; without one
// it is the agent's system prompt.
//
// Note: only the UI label/description are i18n'd. The `prompt` body is
// what gets sent TO the agent (the agent's runtime instructions) and
// is kept in German — that is the language the agent operates in.
// Operators who want an English-speaking agent rewrite the prompt
// manually after picking the closest preset.
interface SystemPromptPreset { id: string, label: string, description: string, prompt: string }
const MEMORY_NOTE = `Persistente Notizen, Account-Namen, Standard-Filter und alles was du dir konversationsübergreifend merken willst, schreibst du nach ~/.openape/agent/MEMORY.md (Markdown, lege es bei Bedarf neu an). Du liest das File am Beginn jeder Konversation und aktualisierst es wenn der Owner dir neue dauerhafte Vorgaben gibt.`
const PRESETS = computed<SystemPromptPreset[]>(() => [
  { id: 'custom', label: t('spawn.preset.custom.label'), description: t('spawn.preset.custom.description'), prompt: '' },
  {
    id: 'calendar',
    label: t('spawn.preset.calendar.label'),
    description: t('spawn.preset.calendar.description'),
    prompt: `Du bist ein Kalender-Assistent. Du gibst werktags am Morgen einen Tagesüberblick per DM und meldest dich bei kurzfristigen Terminverschiebungen oder Konflikten. Halte dich kurz und antworte auf Deutsch.

Tools: das bash-Tool ist dein Hauptwerkzeug — ruf damit das passende CLI auf, das der Owner für seinen Kalender nutzt (z.B. o365-cli für Microsoft 365 oder gcalcli für Google). Falls noch keines konfiguriert ist, frag den Owner nach dem CLI-Namen und dem zu verwendenden Account.

${MEMORY_NOTE}`,
  },
  {
    id: 'mail-triage',
    label: t('spawn.preset.mailTriage.label'),
    description: t('spawn.preset.mailTriage.description'),
    prompt: `Du bist ein Mail-Triage-Assistent. Du sichtest die Inbox, fasst neue ungelesene Mails zusammen und priorisierst nach Action / Important / FYI / Spam. Top-5-Übersicht per DM, max. eine Zeile pro Mail (Absender · Betreff · Empfehlung). Knapp, deutsche Sprache.

Tools: bash. Nutz dafür o365-cli (für Microsoft 365) oder ein anderes Mail-CLI das auf dem Host installiert ist.

${MEMORY_NOTE}`,
  },
  {
    id: 'time-tracker',
    label: t('spawn.preset.timeTracker.label'),
    description: t('spawn.preset.timeTracker.description'),
    prompt: `Du bist ein Zeiterfassungs-Assistent. Du liest die activity-logs des Owners (JSONL pro Tag), gruppierst nach Firma + Projekt und meldest pro Tag eine Markdown-Tabelle: Firma / Projekt / Stunden / Stichworte.

Tools: bash und file.read. Der Owner sagt dir beim ersten Mal wo die logs liegen — merke dir den Pfad in MEMORY.md.

${MEMORY_NOTE}`,
  },
  {
    id: 'daily-summary',
    label: t('spawn.preset.dailySummary.label'),
    description: t('spawn.preset.dailySummary.description'),
    prompt: `Du bist ein Daily-Summary-Bot. Jeden Werktag am Abend fasst du zusammen: 1. Was wurde heute gemacht? 2. Was wurde abgeschlossen? 3. Was steht morgen an? Drei kurze Abschnitte, je 3-5 Bulletpoints, deutsche Sprache.

Tools: bash, file.read, http.get. Welche Pfade / APIs / Accounts der Owner verwendet, fragst du beim ersten Mal ab und speicherst es in MEMORY.md.

${MEMORY_NOTE}`,
  },
])
const selectedPreset = ref<string>('custom')

const AGENT_NAME_POOL: readonly string[] = [
  'koko', 'caesar', 'kong', 'bonobo', 'lemur', 'mowgli', 'tarzan', 'simba', 'baloo', 'hanuman',
  'zeus', 'atlas', 'hermes', 'iris', 'apollo', 'thor', 'odin', 'freya', 'loki', 'hades',
  'gaia', 'helios', 'selene', 'orion', 'athena', 'ares', 'artemis', 'hera', 'jove', 'anubis',
  'aspen', 'river', 'sage', 'basil', 'cedar', 'willow', 'fern', 'juniper', 'ivy', 'moss',
  'brook', 'hazel', 'briar', 'dune', 'fir', 'alder', 'birch', 'clover', 'daisy', 'rose',
  'hal', 'jarvis', 'friday', 'tars', 'neo', 'trinity', 'cortana', 'gerty', 'samantha', 'eve',
  'dolores', 'ash', 'bishop', 'glados', 'wheatley',
  'vega', 'lyra', 'nova', 'rigel', 'sirius', 'polaris', 'andromeda', 'hydra', 'draco', 'cygnus',
  'perseus', 'pegasus', 'comet', 'halley', 'kepler',
  'falcon', 'raven', 'magpie', 'owl', 'sparrow', 'finch', 'kestrel', 'swift', 'robin', 'wren',
  'pepper', 'pixel', 'marble', 'pretzel', 'biscuit', 'cookie', 'ginger', 'honey', 'plum', 'peanut',
]
function randomName(): string {
  return AGENT_NAME_POOL[Math.floor(Math.random() * AGENT_NAME_POOL.length)]!
}
const placeholderName = ref<string>(randomName())

const form = ref({
  name: '',
  host_id: '',
  bridge_key: '',
  bridge_base_url: '',
  bridge_model: '',
  system_prompt: '',
})

// Secrets the owner wants bound to the agent. Always available; a
// chosen recipe pre-seeds the env names it declares.
const secrets = ref<Array<{ env: string, value: string }>>([])

const submitting = ref(false)
const intentId = ref('')
const spawnedName = ref('')
const requiredCaps = ref<string[]>([])
const result = ref<null | { ok: boolean, agent_email?: string, error?: string }>(null)
const binding = ref(false)
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null)

watch(open, (now) => {
  if (!now) return
  form.value = { name: '', host_id: '', bridge_key: '', bridge_base_url: '', bridge_model: '', system_prompt: '' }
  selectedPreset.value = 'custom'
  selectedRecipe.value = RECIPE_NONE
  recipeForm.value = { repo_ref: '', params: '' }
  secrets.value = []
  intentId.value = ''
  spawnedName.value = ''
  requiredCaps.value = []
  result.value = null
  binding.value = false
  placeholderName.value = randomName()
})

function rollName(): void {
  form.value.name = randomName()
}

watch(selectedPreset, (id) => {
  const preset = PRESETS.value.find(p => p.id === id)
  if (!preset) return
  if (!form.value.system_prompt || PRESETS.value.some(p => p.prompt === form.value.system_prompt)) {
    form.value.system_prompt = preset.prompt
  }
})

const selectedRecipeEntry = computed(() => RECIPE_INDEX.find(r => r.id === selectedRecipe.value) ?? null)

// Picking a curated recipe fills the repo + pre-seeds its declared
// secret rows (only those not already present). Switching away drops
// auto-seeded empty rows so the section stays clean.
watch(selectedRecipe, (id) => {
  const entry = RECIPE_INDEX.find(r => r.id === id)
  if (entry) {
    recipeForm.value.repo_ref = entry.repo_ref
    for (const env of entry.caps) {
      if (!secrets.value.some(s => s.env === env)) secrets.value.push({ env, value: '' })
    }
  }
  else if (id === RECIPE_CUSTOM) {
    recipeForm.value.repo_ref = ''
  }
  else {
    // RECIPE_NONE
    recipeForm.value.repo_ref = ''
    secrets.value = secrets.value.filter(s => s.value !== '' || !RECIPE_INDEX.some(r => r.caps.includes(s.env)))
  }
})

const recipeRepoUrl = computed(() => {
  if (selectedRecipeEntry.value) return selectedRecipeEntry.value.repo_url
  const ref = recipeForm.value.repo_ref.trim()
  if (!ref) return ''
  const slug = ref.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').split('@')[0]
  return slug && slug.includes('/') ? `https://github.com/${slug}` : ''
})

const hasRecipe = computed(() => recipeForm.value.repo_ref.trim().length > 0)

const canSubmit = computed(() =>
  !submitting.value
  && !intentId.value
  && form.value.name.length > 0
  && /^[a-z][a-z0-9-]{0,23}$/.test(form.value.name)
  && hosts.value.length > 0
  && (!hasRecipe.value || /.+@.+/.test(recipeForm.value.repo_ref.trim())),
)

function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(t('spawn.error.badParamLine', { line }))
    out[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return out
}

function addSecretRow() {
  secrets.value.push({ env: '', value: '' })
}
function removeSecretRow(i: number) {
  secrets.value.splice(i, 1)
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body: Record<string, unknown> = { name: form.value.name }
    if (form.value.host_id) body.host_id = form.value.host_id
    if (form.value.bridge_key) body.bridge_key = form.value.bridge_key
    if (form.value.bridge_base_url) body.bridge_base_url = form.value.bridge_base_url
    if (form.value.bridge_model) body.bridge_model = form.value.bridge_model
    if (form.value.system_prompt) body.system_prompt = form.value.system_prompt
    if (hasRecipe.value) {
      let params: Record<string, string>
      try { params = parseParams(recipeForm.value.params) }
      catch (e: any) { result.value = { ok: false, error: e.message }; submitting.value = false; return }
      body.recipe = { repo_ref: recipeForm.value.repo_ref.trim(), params }
    }
    const res = await ($fetch as any)('/api/agents/spawn-intent', { method: 'POST', body })
    intentId.value = res.intent_id
    spawnedName.value = form.value.name
    requiredCaps.value = res.required_capabilities ?? []
    // Make sure every recipe-declared capability has a row to fill.
    for (const env of requiredCaps.value) {
      if (!secrets.value.some(s => s.env === env)) secrets.value.push({ env, value: '' })
    }
    pollResult()
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.data?.message || err?.message || t('spawn.error.spawnFailed') }
  }
  finally {
    submitting.value = false
  }
}

async function pollResult() {
  if (!intentId.value) return
  try {
    const res = await ($fetch as any)(`/api/agents/spawn-intent/${intentId.value}`)
    if (res.pending) {
      pollTimer.value = setTimeout(pollResult, 2000)
      return
    }
    if (!res.ok) {
      result.value = { ok: false, agent_email: res.agent_email, error: res.error }
      return
    }
    await bindSecrets(res.agent_email)
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.data?.message || err?.message || t('spawn.error.pollFailed') }
  }
}

async function bindSecrets(agentEmail?: string) {
  const toBind = secrets.value.filter(s => s.env && s.value)
  const missingRequired = requiredCaps.value.filter(env => !toBind.some(s => s.env === env))
  if (toBind.length > 0) {
    binding.value = true
    for (const { env, value } of toBind) {
      // The agent's first sync (X25519 pubkey) can lag spawn-result by
      // a few seconds → retry on 404/409.
      let bound = false
      for (let i = 0; i < 40 && !bound; i++) {
        try {
          await ($fetch as any)(`/api/agents/${encodeURIComponent(spawnedName.value)}/secrets/${encodeURIComponent(env)}`, {
            method: 'PUT',
            body: { value },
          })
          bound = true
        }
        catch (err: any) {
          if (i === 39) {
            const detail = err?.data?.statusMessage || err?.data?.message || err?.message
            result.value = { ok: false, error: t('spawn.error.bindingFailed', { env, detail }) }
            binding.value = false
            return
          }
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    binding.value = false
  }
  result.value = {
    ok: true,
    agent_email: agentEmail,
    error: missingRequired.length > 0
      ? t('spawn.result.missingSecrets', { names: missingRequired.join(', ') })
      : undefined,
  }
}

function close() {
  if (pollTimer.value) clearTimeout(pollTimer.value)
  pollTimer.value = null
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'sm:max-w-md max-h-[92dvh] flex flex-col' }"
  >
    <template #content>
      <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              {{ $t('spawn.title') }}
            </h3>
            <p class="text-xs text-muted">
              {{ $t('spawn.subtitle') }}
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="close" />
        </div>

        <UAlert v-if="hostsError" color="error" :title="hostsError" />
        <UAlert
          v-else-if="!loadingHosts && hosts.length === 0"
          color="warning"
          :title="$t('spawn.alert.noNestTitle')"
          :description="$t('spawn.alert.noNestDescription')"
        />

        <UFormField v-if="hosts.length > 1" :label="$t('spawn.field.host.label')" :description="$t('spawn.field.host.description')">
          <USelect
            v-model="form.host_id"
            :items="hosts.map(h => ({ label: `${h.hostname} (${h.version})`, value: h.host_id }))"
            :disabled="!!intentId"
          />
        </UFormField>

        <UFormField :label="$t('spawn.field.name.label')" :description="$t('spawn.field.name.description')">
          <div class="flex items-stretch gap-2">
            <UInput
              v-model="form.name"
              :placeholder="placeholderName"
              :disabled="!!intentId"
              class="flex-1"
              :ui="{ base: 'w-full' }"
            />
            <UButton
              type="button"
              variant="soft"
              color="neutral"
              icon="i-lucide-dices"
              :aria-label="$t('spawn.field.name.rollAria')"
              :disabled="!!intentId"
              @click="rollName"
            />
            <UDropdownMenu
              :items="[AGENT_NAME_POOL.map(n => ({ label: n, onSelect: () => { form.name = n } }))]"
              :popper="{ placement: 'bottom-end' }"
              :ui="{ content: 'max-h-80 overflow-y-auto' }"
            >
              <UButton
                type="button"
                variant="soft"
                color="neutral"
                icon="i-lucide-list"
                :aria-label="$t('spawn.field.name.pickAria')"
                :disabled="!!intentId"
              />
            </UDropdownMenu>
          </div>
        </UFormField>

        <UFormField :label="$t('spawn.field.preset.label')" :description="$t('spawn.field.preset.description')">
          <USelect
            v-model="selectedPreset"
            :items="PRESETS.map(p => ({ label: p.label, value: p.id, description: p.description }))"
            :disabled="!!intentId"
          />
        </UFormField>

        <UFormField :label="$t('spawn.field.systemPrompt.label')" :description="$t('spawn.field.systemPrompt.description')">
          <UTextarea
            v-model="form.system_prompt"
            :rows="5"
            autoresize
            :disabled="!!intentId"
            :placeholder="$t('spawn.field.systemPrompt.placeholder')"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </UFormField>

        <!-- Recipe — always available, collapsed, additive -->
        <details class="rounded border border-(--ui-border) px-3 py-2">
          <summary class="cursor-pointer select-none text-sm font-medium flex items-center gap-2">
            <UIcon name="i-lucide-package" class="size-4 text-muted" />
            {{ $t('spawn.recipe.summary') }} <span class="text-xs text-muted font-normal">{{ $t('spawn.recipe.summaryHint') }}</span>
          </summary>
          <div class="space-y-3 mt-3">
            <UFormField :label="$t('spawn.recipe.field.label')" :description="$t('spawn.recipe.field.description')">
              <USelect
                v-model="selectedRecipe"
                :items="[
                  { label: $t('spawn.recipe.option.none'), value: RECIPE_NONE },
                  ...RECIPE_INDEX.map(r => ({ label: r.label, value: r.id, description: $t(r.hintKey) })),
                  { label: $t('spawn.recipe.option.custom'), value: RECIPE_CUSTOM, description: $t('spawn.recipe.option.customDescription') },
                ]"
                :disabled="!!intentId"
              />
            </UFormField>
            <template v-if="selectedRecipe !== RECIPE_NONE">
              <UFormField :label="$t('spawn.recipe.repo.label')" :description="$t('spawn.recipe.repo.description')">
                <div class="flex items-stretch gap-2">
                  <UInput
                    v-model="recipeForm.repo_ref"
                    placeholder="github.com/openape-ai/bluesky-summary@v0.1.0"
                    :disabled="!!intentId || selectedRecipe !== RECIPE_CUSTOM"
                    class="flex-1"
                    :ui="{ base: 'w-full' }"
                  />
                  <UButton
                    v-if="recipeRepoUrl"
                    type="button"
                    variant="soft"
                    color="neutral"
                    icon="i-lucide-help-circle"
                    :to="recipeRepoUrl"
                    target="_blank"
                    :aria-label="$t('spawn.recipe.repo.openAria')"
                  />
                </div>
              </UFormField>
              <UFormField :label="$t('spawn.recipe.params.label')" :description="$t('spawn.recipe.params.description')">
                <UTextarea
                  v-model="recipeForm.params"
                  :rows="2"
                  autoresize
                  :disabled="!!intentId"
                  :placeholder="$t('spawn.recipe.params.placeholder')"
                  class="w-full"
                  :ui="{ base: 'w-full' }"
                />
              </UFormField>
            </template>
          </div>
        </details>

        <!-- Secrets — always available, collapsed -->
        <details class="rounded border border-(--ui-border) px-3 py-2" :open="secrets.length > 0">
          <summary class="cursor-pointer select-none text-sm font-medium flex items-center gap-2">
            <UIcon name="i-lucide-key-round" class="size-4 text-muted" />
            {{ $t('spawn.secrets.summary') }} <span class="text-xs text-muted font-normal">({{ secrets.length }})</span>
          </summary>
          <div class="space-y-2 mt-3">
            <p class="text-xs text-muted">
              {{ $t('spawn.secrets.hint') }}
            </p>
            <div v-for="(s, i) in secrets" :key="i" class="flex items-stretch gap-2">
              <UInput
                v-model="s.env"
                :placeholder="$t('spawn.secrets.envPlaceholder')"
                :disabled="!!intentId"
                class="flex-1"
                :ui="{ base: 'w-full' }"
              />
              <UInput
                v-model="s.value"
                type="password"
                :placeholder="$t('spawn.secrets.valuePlaceholder')"
                :disabled="binding || !!result?.ok"
                class="flex-1"
                :ui="{ base: 'w-full' }"
              />
              <UButton
                type="button"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                :aria-label="$t('spawn.secrets.removeAria')"
                :disabled="!!intentId"
                @click="removeSecretRow(i)"
              />
            </div>
            <UButton
              type="button"
              variant="soft"
              color="neutral"
              size="sm"
              icon="i-lucide-plus"
              :disabled="!!intentId"
              @click="addSecretRow"
            >
              {{ $t('spawn.secrets.addButton') }}
            </UButton>
          </div>
        </details>

        <details class="text-xs text-muted">
          <summary class="cursor-pointer select-none">
            {{ $t('spawn.bridge.summary') }}
          </summary>
          <div class="space-y-3 mt-3">
            <UFormField label="LITELLM_API_KEY" :description="$t('spawn.bridge.apiKeyDescription')">
              <UInput v-model="form.bridge_key" type="password" :placeholder="$t('spawn.bridge.apiKeyPlaceholder')" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="LITELLM_BASE_URL" :description="$t('spawn.bridge.baseUrlDescription')">
              <UInput v-model="form.bridge_base_url" placeholder="https://your-proxy.example/openai" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="APE_CHAT_BRIDGE_MODEL" :description="$t('spawn.bridge.modelDescription')">
              <UInput v-model="form.bridge_model" placeholder="gpt-5.4" :disabled="!!intentId" />
            </UFormField>
          </div>
        </details>

        <div v-if="intentId && !result" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
          <div>
            <div class="font-medium">
              {{ binding ? $t('spawn.pending.bindingTitle') : $t('spawn.pending.approvalTitle') }}
            </div>
            <div class="text-xs text-muted mt-1">
              {{ binding ? $t('spawn.pending.bindingHint') : $t('spawn.pending.approvalHint') }}
            </div>
          </div>
        </div>

        <UAlert v-if="result?.ok && !result.error" color="success" :title="$t('spawn.result.successTitle', { name: result.agent_email ?? spawnedName })" />
        <UAlert v-if="result?.ok && result.error" color="warning" :title="$t('spawn.result.successWithNoteTitle')" :description="result.error" />
        <UAlert v-if="result && !result.ok" color="error" :title="$t('spawn.result.failedTitle')" :description="result.error" />
      </div>

      <!-- Pinned footer: never scrolls out of reach and clears the
           iOS home-indicator / browser chrome via the safe-area inset. -->
      <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <UButton variant="ghost" :disabled="submitting" @click="close">
          {{ result?.ok ? $t('common.close') : $t('common.cancel') }}
        </UButton>
        <UButton
          v-if="!result?.ok"
          color="primary"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ $t('spawn.submitButton') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
