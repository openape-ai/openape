<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface NestHost {
  host_id: string
  hostname: string
  version: string
  last_seen_at: number
}

const open = defineModel<boolean>('open', { default: false })

const hosts = ref<NestHost[]>([])
const hostsError = ref('')
const loadingHosts = ref(false)

async function loadHosts() {
  loadingHosts.value = true
  hostsError.value = ''
  try { hosts.value = await ($fetch as any)('/api/nest/hosts') }
  catch (err: any) {
    hostsError.value = err?.data?.statusMessage || err?.message || 'failed to load nest hosts'
  }
  finally {
    loadingHosts.value = false
  }
}

watch(open, (now) => { if (now) loadHosts() })

// Quick-start system-prompt presets surfaced as a select-menu in the
// dialog. Each one ships a German-language persona for a common
// single-purpose workflow (mail triage, calendar, time tracking, …)
// and references the right tools out of the agent's built-in fundus
// rather than baking in any one user's name/accounts. The personal
// bits (which O365 account, which folder, …) get stored by the
// agent in ~/.openape/agent/MEMORY.md — a small per-agent persistent
// memory the prompt teaches the LLM to maintain across turns.
//
// On submit, after the spawn-result lands, we PATCH the new agent
// with the preset's system_prompt so the agent runs the right
// persona from the first message. 'custom' = blank, user fills the
// textarea themselves.
interface SystemPromptPreset {
  id: string
  label: string
  description: string
  prompt: string
}

// Reused across every preset — establishes the per-agent persistent
// memory pattern. Same shape as Claude's auto-memory: small file on
// disk, read at the start of each turn, written when something
// worth remembering across conversations comes up.
const MEMORY_NOTE = `Persistente Notizen, Account-Namen, Standard-Filter und alles was du dir konversationsübergreifend merken willst, schreibst du nach ~/.openape/agent/MEMORY.md (Markdown, lege es bei Bedarf neu an). Du liest das File am Beginn jeder Konversation und aktualisierst es wenn der Owner dir neue dauerhafte Vorgaben gibt.`

const PRESETS: SystemPromptPreset[] = [
  {
    id: 'custom',
    label: 'Custom (leer)',
    description: 'Eigenen System-Prompt schreiben oder später im Agent-Detail setzen.',
    prompt: '',
  },
  {
    id: 'calendar',
    label: '📅 Kalender-Assistent',
    description: 'Tagesüberblick am Morgen, Hinweise zu Verschiebungen / Konflikten.',
    prompt: `Du bist ein Kalender-Assistent. Du gibst werktags am Morgen einen Tagesüberblick per DM und meldest dich bei kurzfristigen Terminverschiebungen oder Konflikten. Halte dich kurz und antworte auf Deutsch.

Tools: das bash-Tool ist dein Hauptwerkzeug — ruf damit das passende CLI auf, das der Owner für seinen Kalender nutzt (z.B. o365-cli für Microsoft 365 oder gcalcli für Google). Falls noch keines konfiguriert ist, frag den Owner nach dem CLI-Namen und dem zu verwendenden Account.

${MEMORY_NOTE}`,
  },
  {
    id: 'mail-triage',
    label: '📬 Mail-Triage',
    description: 'Sichtet ungelesene Mails, priorisiert Action / Important / FYI / Spam.',
    prompt: `Du bist ein Mail-Triage-Assistent. Du sichtest die Inbox, fasst neue ungelesene Mails zusammen und priorisierst nach Action / Important / FYI / Spam. Top-5-Übersicht per DM, max. eine Zeile pro Mail (Absender · Betreff · Empfehlung). Knapp, deutsche Sprache.

Tools: bash. Nutz dafür o365-cli (für Microsoft 365) oder ein anderes Mail-CLI das auf dem Host installiert ist — z.B. \`o365-cli mail list --account <name> --json --unread --limit 50\` für die Inbox-Übersicht.

Account-Namen sind nicht vorgegeben — frag den Owner beim ersten Mal welche(n) er triagieren möchte, und merke dir diese in MEMORY.md.

${MEMORY_NOTE}`,
  },
  {
    id: 'time-tracker',
    label: '⏱ Zeiterfassung',
    description: 'Wertet activity-logs aus, fasst Stunden pro Projekt / Firma zusammen.',
    prompt: `Du bist ein Zeiterfassungs-Assistent. Du liest die activity-logs des Owners (Format: JSONL pro Tag, eine Zeile pro logged action mit \`ts, project, company, type, action\`), gruppierst nach Firma + Projekt und meldest pro Tag eine Markdown-Tabelle: Firma / Projekt / Stunden / Stichworte.

Tools: bash und file.read. Der Owner sagt dir beim ersten Mal wo die logs liegen (z.B. ~/.claude/activity-logs/YYYY-MM-DD.jsonl) — merke dir den Pfad in MEMORY.md. Sind keine logs für den abgefragten Zeitraum da: sag es klar statt zu erfinden.

${MEMORY_NOTE}`,
  },
  {
    id: 'file-organizer',
    label: '📁 File-Verwalter',
    description: 'Überprüft Downloads, schlägt Verschiebungen vor, räumt auf Anfrage auf.',
    prompt: `Du bist ein File-Verwalter. Du überprüfst regelmäßig den Downloads-Ordner des Owners und schlägst sinnvolle Verschiebungen vor (PDFs in den Dokumenten-Ordner, Bilder in den Pictures-Ordner, Code-Archive in den Code-Ordner, …). Auf explizite Anfrage räumst du aktiv auf — vor jedem rm fragst du nochmal nach.

Tools: bash, file.read, file.write. Frag den Owner beim ersten Mal nach seinen bevorzugten Zielordnern und Ausnahmen (z.B. "PDF-Rechnungen separat") und schreibe das Mapping in MEMORY.md.

${MEMORY_NOTE}`,
  },
  {
    id: 'reminder-bot',
    label: '🔔 Wiedervorlage-Bot',
    description: 'Checkt fällige Tasks/Erinnerungen und meldet anstehende per DM.',
    prompt: `Du bist ein Wiedervorlage-Bot. Du checkst täglich am Morgen die offenen Tasks und Erinnerungen des Owners und meldest per DM die, deren due_at oder remind_at im nächsten Tag fällig wird. Format pro Task: "● <title> (fällig <DD.MM. HH:MM>) — <kurzer Kontext>". Knapp, deutsche Sprache.

Tools: bash (für ape-tasks und andere CLI-basierte Task-Quellen) oder http.get (für REST-APIs). Welche Quelle benutzt wird, sagt dir der Owner beim ersten Mal — merke sie dir samt Filter (status=open,doing) in MEMORY.md.

${MEMORY_NOTE}`,
  },
  {
    id: 'daily-summary',
    label: '🗞 Daily Summary',
    description: 'Synthetisiert activity-logs + tasks + Termine zu einem End-of-day Bericht.',
    prompt: `Du bist ein Daily-Summary-Bot. Jeden Werktag am Abend fasst du zusammen:
1. Was wurde heute gemacht? (Quelle: activity-logs)
2. Was wurde abgeschlossen? (Tasks mit status=done heute)
3. Was steht morgen an? (offene Tasks + Kalender)

Format: drei kurze Abschnitte (Heute / Erledigt / Morgen), je 3-5 Bulletpoints. Deutsche Sprache.

Tools: bash, file.read, http.get. Welche konkreten Pfade / APIs / Accounts der Owner verwendet (welcher Kalender, welcher Task-Tracker, welche Log-Datei) fragst du beim ersten Mal ab und speicherst es in MEMORY.md.

${MEMORY_NOTE}`,
  },
]
const selectedPreset = ref<string>('custom')

// Curated 100-name pool surfaced behind a 🎲 button + a "pick from
// list" dropdown. The agent-name regex caps at 24 chars / [a-z0-9-]
// so every entry here stays inside that ceiling. Themes: primates,
// Greek/Norse myth, nature, sci-fi AI, stars, birds, cute everyday.
// One placeholder rotates on every dialog-open so users don't see
// "igor31" on repeat.
const AGENT_NAME_POOL: readonly string[] = [
  // Primates / classic ape characters
  'koko', 'caesar', 'kong', 'bonobo', 'lemur', 'mowgli', 'tarzan', 'simba', 'baloo', 'hanuman',
  // Mythology
  'zeus', 'atlas', 'hermes', 'iris', 'apollo', 'thor', 'odin', 'freya', 'loki', 'hades',
  'gaia', 'helios', 'selene', 'orion', 'athena', 'ares', 'artemis', 'hera', 'jove', 'anubis',
  // Nature / botany
  'aspen', 'river', 'sage', 'basil', 'cedar', 'willow', 'fern', 'juniper', 'ivy', 'moss',
  'brook', 'hazel', 'briar', 'dune', 'fir', 'alder', 'birch', 'clover', 'daisy', 'rose',
  // Sci-fi AIs / robots
  'hal', 'jarvis', 'friday', 'tars', 'neo', 'trinity', 'cortana', 'gerty', 'samantha', 'eve',
  'dolores', 'ash', 'bishop', 'glados', 'wheatley',
  // Stars + space
  'vega', 'lyra', 'nova', 'rigel', 'sirius', 'polaris', 'andromeda', 'hydra', 'draco', 'cygnus',
  'perseus', 'pegasus', 'comet', 'halley', 'kepler',
  // Birds
  'falcon', 'raven', 'magpie', 'owl', 'sparrow', 'finch', 'kestrel', 'swift', 'robin', 'wren',
  // Cute everyday
  'pepper', 'pixel', 'marble', 'pretzel', 'biscuit', 'cookie', 'ginger', 'honey', 'plum', 'peanut',
]

function randomName(): string {
  return AGENT_NAME_POOL[Math.floor(Math.random() * AGENT_NAME_POOL.length)]!
}

// Rotates each time the dialog opens — placeholder hints at the
// 100-name pool without committing to any single label.
const placeholderName = ref<string>(randomName())

// Reset form whenever the dialog opens. We don't pre-fill from the
// previous spawn — names are unique per owner so reusing would
// guarantee a 409 anyway, and the bridge config is per-agent.
const form = ref({
  name: '',
  host_id: '',
  bridge_key: '',
  bridge_base_url: '',
  bridge_model: '',
  system_prompt: '',
})
const submitting = ref(false)
const intentId = ref('')
const spawnedName = ref('')
const result = ref<null | { ok: boolean, agent_email?: string, error?: string }>(null)
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null)

watch(open, (now) => {
  if (!now) return
  form.value = { name: '', host_id: '', bridge_key: '', bridge_base_url: '', bridge_model: '', system_prompt: '' }
  selectedPreset.value = 'custom'
  intentId.value = ''
  spawnedName.value = ''
  result.value = null
  placeholderName.value = randomName()
})

// 🎲 button beside the name input — fills the field with a random
// pool pick. Clicking it again rolls a new name. Owners who prefer
// typing their own ignore the button entirely.
function rollName(): void {
  form.value.name = randomName()
}

watch(selectedPreset, (id) => {
  const preset = PRESETS.find(p => p.id === id)
  if (!preset) return
  // Only overwrite the textarea when the user hasn't typed anything
  // custom yet. Otherwise the preset switch would silently nuke their
  // edits. Empty selection always overwrites (it's the explicit reset).
  if (!form.value.system_prompt || PRESETS.some(p => p.prompt === form.value.system_prompt)) {
    form.value.system_prompt = preset.prompt
  }
})

const canSubmit = computed(() =>
  !submitting.value
  && !intentId.value
  && form.value.name.length > 0
  && /^[a-z][a-z0-9-]{0,23}$/.test(form.value.name)
  && hosts.value.length > 0,
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body: Record<string, string> = { name: form.value.name }
    if (form.value.host_id) body.host_id = form.value.host_id
    if (form.value.bridge_key) body.bridge_key = form.value.bridge_key
    if (form.value.bridge_base_url) body.bridge_base_url = form.value.bridge_base_url
    if (form.value.bridge_model) body.bridge_model = form.value.bridge_model
    const res = await ($fetch as any)('/api/agents/spawn-intent', { method: 'POST', body })
    intentId.value = res.intent_id
    spawnedName.value = form.value.name
    pollResult()
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.message || 'spawn failed' }
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
      // Owner is still on the approve-grant screen on their phone.
      // Re-check in 2s. The intent map auto-prunes after 30min so we
      // don't poll forever — but the UI dialog will close on dismiss.
      pollTimer.value = setTimeout(pollResult, 2000)
      return
    }
    result.value = { ok: res.ok, agent_email: res.agent_email, error: res.error }
    // On success, persist the chosen system_prompt to the troop DB.
    // The agent picks it up on its next sync (~5min) or sooner via
    // the WS config-update broadcast that already fires on PATCH.
    // We don't fail the whole spawn over a save error here — the
    // agent exists, the user can still edit the prompt from the
    // detail page.
    if (res.ok && form.value.system_prompt) {
      try {
        await ($fetch as any)(`/api/agents/${encodeURIComponent(spawnedName.value)}`, {
          method: 'PATCH',
          body: { system_prompt: form.value.system_prompt },
        })
      }
      catch (err: any) {
        // Surface but don't overwrite the success state.
        result.value = {
          ok: true,
          agent_email: res.agent_email,
          error: `Agent spawned but system_prompt save failed: ${err?.data?.statusMessage || err?.message || 'unknown'} — set it manually on the agent page.`,
        }
      }
    }
  }
  catch (err: any) {
    result.value = { ok: false, error: err?.data?.statusMessage || err?.message || 'poll failed' }
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
    :ui="{
      content: 'sm:max-w-md max-h-[90vh] flex flex-col',
    }"
  >
    <template #content>
      <div class="p-5 space-y-4 overflow-y-auto">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold">
              Spawn agent
            </h3>
            <p class="text-xs text-muted">
              Runs <code>apes agents spawn</code> on the selected Mac. You'll get a DDISA grant request on your iPhone — approve to complete.
            </p>
          </div>
          <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="close" />
        </div>

        <UAlert v-if="hostsError" color="error" :title="hostsError" />
        <UAlert
          v-else-if="!loadingHosts && hosts.length === 0"
          color="warning"
          title="No connected nest"
          description="Start the nest daemon on a Mac (apes nest install + run) and refresh. The legacy `apes nest spawn` CLI path still works as a fallback."
        />

        <UFormField v-if="hosts.length > 1" label="Host" description="You have multiple Macs connected — pick the one to spawn on.">
          <USelect
            v-model="form.host_id"
            :items="hosts.map(h => ({ label: `${h.hostname} (${h.version})`, value: h.host_id }))"
            :disabled="!!intentId"
          />
        </UFormField>

        <UFormField label="Name" description="lowercase, [a-z0-9-], max 24 chars — or pick from the list">
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
              aria-label="Roll a random name"
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
                aria-label="Pick from name list"
                :disabled="!!intentId"
              />
            </UDropdownMenu>
          </div>
        </UFormField>

        <UFormField label="Preset" description="Quick-start system prompt. You can tweak the textarea below or pick 'Custom' for a blank slate.">
          <USelect
            v-model="selectedPreset"
            :items="PRESETS.map(p => ({ label: p.label, value: p.id, description: p.description }))"
            :disabled="!!intentId"
          />
        </UFormField>

        <UFormField label="System prompt" description="Was der Agent immer im Kopf hat. Edits hier kommen mit dem nächsten Sync auf den Host — du kannst auch später auf der Agent-Seite anpassen.">
          <UTextarea
            v-model="form.system_prompt"
            :rows="6"
            autoresize
            :disabled="!!intentId"
            placeholder="Du bist …"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </UFormField>

        <details class="text-xs text-muted">
          <summary class="cursor-pointer select-none">
            Bridge overrides (optional)
          </summary>
          <div class="space-y-3 mt-3">
            <UFormField label="LITELLM_API_KEY" description="Defaults to ~/litellm/.env on the host.">
              <UInput v-model="form.bridge_key" type="password" placeholder="sk-… or token" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="LITELLM_BASE_URL" description="Defaults to http://127.0.0.1:4000/v1">
              <UInput v-model="form.bridge_base_url" placeholder="https://your-proxy.example/openai" :disabled="!!intentId" />
            </UFormField>
            <UFormField label="APE_CHAT_BRIDGE_MODEL" description="Required by the bridge at runtime.">
              <UInput v-model="form.bridge_model" placeholder="gpt-5.4" :disabled="!!intentId" />
            </UFormField>
          </div>
        </details>

        <div v-if="intentId && !result" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
          <div>
            <div class="font-medium">
              Waiting for DDISA approval…
            </div>
            <div class="text-xs text-muted mt-1">
              Approve the as=root grant in the OpenApe app on your phone. This dialog updates automatically when the spawn completes.
            </div>
          </div>
        </div>

        <UAlert v-if="result?.ok" color="success" :title="`Spawned: ${result.agent_email ?? form.name}`" />
        <UAlert v-if="result && !result.ok" color="error" title="Spawn failed" :description="result.error" />

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :disabled="submitting" @click="close">
            {{ result?.ok ? 'Close' : 'Cancel' }}
          </UButton>
          <UButton
            v-if="!result?.ok"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submit"
          >
            Spawn
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
