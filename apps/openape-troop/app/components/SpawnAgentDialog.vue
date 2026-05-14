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
// dialog. Each one ships a German-language persona aimed at a real
// workflow Patrick uses (mail triage, calendar, time tracking, …).
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
    description: 'Tagesüberblick um 8 Uhr, Erinnerung bei kurzfristigen Verschiebungen.',
    prompt: `Du bist Patricks Kalender-Assistent. Du gibst werktags um 8 Uhr einen Tagesüberblick per DM und meldest dich aktiv bei kurzfristigen Terminverschiebungen oder Konflikten. Du nutzt das http.get-Tool um den O365-Kalender abzurufen.
Halte dich kurz. Antworte auf Deutsch.`,
  },
  {
    id: 'mail-triage',
    label: '📬 Mail-Triage',
    description: 'Sichtet ungelesene Mails, priorisiert Action / Important / FYI / Spam, schickt 2x täglich die Top-5.',
    prompt: `Du bist Patricks Mail-Triage-Assistent. Sichtest die Inbox, fasst neue ungelesene Mails zusammen und priorisierst nach Action / Important / FYI / Spam. Du schickst 9 Uhr und 14 Uhr per DM die Top-5 wichtigsten neuen Mails — max. eine Zeile pro Mail, Absender + Betreff + Empfehlung.
Tools: mail.list, mail.search. Knapp, deutsche Sprache.`,
  },
  {
    id: 'time-tracker',
    label: '⏱ Zeiterfassung',
    description: 'Wertet activity-logs aus, fasst täglich um 18 Uhr Stunden pro Projekt / Firma zusammen.',
    prompt: `Du bist Patricks Zeiterfassungs-Assistent. Du liest die activity-logs unter ~/.claude/activity-logs/YYYY-MM-DD.jsonl und fasst täglich um 18 Uhr die geleisteten Stunden zusammen — gruppiert nach Firma (Delta Mind, Legal Tech Services, Linde Digital, personal) und darunter nach Projekt.
Format: Markdown-Tabelle. Tools: file.read. Deutsche Sprache.`,
  },
  {
    id: 'file-organizer',
    label: '📁 File-Verwalter',
    description: 'Überprüft Downloads, schlägt Verschiebungen vor, räumt auf Anfrage auf.',
    prompt: `Du bist Patricks File-Verwalter. Du überprüfst regelmäßig den Downloads-Ordner (~/Downloads) und schlägst Verschiebungen vor (PDFs → ~/Documents, Bilder → ~/Pictures, Code-Archive → ~/Companies/...). Auf Anfrage räumst du aktiv auf.
Vor jedem rm: explizit nachfragen. Tools: file.read, file.write, bash. Deutsche Sprache.`,
  },
  {
    id: 'reminder-bot',
    label: '🔔 Wiedervorlage-Bot',
    description: 'Checkt täglich um 9 Uhr fällige ape-tasks und meldet anstehende per DM.',
    prompt: `Du bist Patricks Wiedervorlage-Bot. Du fragst täglich um 9 Uhr die ape-tasks API ab — https://tasks.openape.ai/api/tasks?status=open,doing — und meldest die Tasks, deren due_at oder remind_at im nächsten Tag fällig wird.
Format pro Task: "● <title> (fällig <DD.MM. HH:MM>) — <kurzer kontext>". Tools: http.get. Deutsche Sprache, knapp.`,
  },
  {
    id: 'daily-summary',
    label: '🗞 Daily Summary',
    description: 'Synthetisiert activity-logs + open tasks + termine zu einem End-of-day Bericht.',
    prompt: `Du bist Patricks Daily-Summary-Bot. Jeden Werktag um 19 Uhr fasst du zusammen:
1. Was wurde heute gemacht? (Quelle: ~/.claude/activity-logs/YYYY-MM-DD.jsonl)
2. Was wurde abgeschlossen? (ape-tasks status done heute)
3. Was steht morgen an? (ape-tasks open + Kalender)

Format: drei kurze Abschnitte (Heute / Erledigt / Morgen), je 3-5 Bulletpoints. Tools: file.read, http.get. Deutsche Sprache.`,
  },
  {
    id: 'iurio-watcher',
    label: '⚖️ IURIO Watcher',
    description: 'Schaut auf Production-Logs + Sentry + IURIO Status, eskaliert bei Auffälligkeiten.',
    prompt: `Du bist der IURIO Production-Watcher (Legal Tech Services / DOCPIT). Du beobachtest die Status-Endpoints und Sentry-Reports, meldest dich bei DOWN-Events sofort per DM, und bei Recovery noch einmal.
Wenn der monitor stündlich grün ist, halte still — keine "alles ok"-Meldungen. Tools: http.get. Englische Sprache (DevOps-Standard).`,
  },
]
const selectedPreset = ref<string>('custom')

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
})

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
      // Patrick is still on the approve-grant screen on his iPhone.
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
  <UModal v-model:open="open">
    <template #content>
      <div class="p-5 space-y-4">
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

        <UFormField label="Name" description="lowercase, [a-z0-9-], max 24 chars">
          <UInput v-model="form.name" placeholder="igor31" :disabled="!!intentId" />
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
              <UInput v-model="form.bridge_base_url" placeholder="https://iurio.headwai.org/openai" :disabled="!!intentId" />
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
              Check your iPhone — Patrick approves the as=root grant in the OpenApe app. This dialog updates automatically when the spawn completes.
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
