<script setup lang="ts">
import { computed } from 'vue'
import type { LocalizedText } from '@openape/grants'
import type { GrantWithCard } from '../utils/grant-card'
import { grantBindingLine, grantValidity } from '../utils/grant-card'
import { formatCliResourceChain, getCliAuthorizationDetails } from '../utils/cli-grants'
import { formatRequesterName, unwrapShellCommand } from '../utils/command-display'
import { commandBlocks } from '../utils/command-structure'
import { grantBatchPath } from '../utils/grant-batch'
import GrantClaims from './GrantClaims.vue'
import GrantRequestedMarker from './GrantRequestedMarker.vue'

const props = defineProps<{ grant: GrantWithCard, german: boolean }>()
defineEmits<{ language: [german: boolean] }>()

const language = computed(() => props.german ? 'de' as const : 'en' as const)
const request = computed(() => props.grant.request)
const registry = computed(() => props.grant.card?.registry ?? null)
const requester = computed(() => props.grant.card?.requester ?? null)
const program = computed(() => props.grant.card?.program ?? null)
const requesterName = computed(() => requester.value?.name || formatRequesterName(request.value.requester))
const line = computed(() => grantBindingLine(props.grant, language.value))
const command = computed(() => unwrapShellCommand(request.value.command))
const structure = computed(() => line.value.structure ?? null)
const blocks = computed(() => structure.value ? commandBlocks(structure.value) : [])
const cliDetails = computed(() => getCliAuthorizationDetails(request.value.authorization_details))
// An exact-command grant binds the whole command line, options included, so it stays visible.
const exactCommand = computed(() => line.value.kind === 'registry' && cliDetails.value.some(detail => detail.constraints?.exact_command) ? command.value : null)
const validity = computed(() => grantValidity(props.grant, language.value))
const batchPath = computed(() => request.value.batch ? grantBatchPath(request.value.requester, request.value.batch.id) : null)
const showsRequested = computed(() => {
  const card = registry.value
  if (!card) return false
  return [card.title, card.statement, card.allows, card.does_not_allow, card.details_note].some(item => item?.requested)
    || [...card.facts, ...card.details].some(field => field.provenance === 'requested')
})

const text = computed(() => props.german
  ? { language: 'English', exactCommand: 'Genauer Befehl', jsonArgument: 'JSON-Argument', arguments: 'Argumente', rawCommand: 'Genauer Befehl als Zeile', permission: 'Angefragte Berechtigung', requestedBy: 'Angefragt von', owner: 'Owner', unregistered: 'Nicht bei diesem IdP registriert', submittedBy: 'Eingereicht über Delegation von', validity: 'Gültigkeit', expires: 'Gültig bis', runAs: 'Ausführen als', batch: 'Teil einer Sammelanfrage', reviewBatch: 'Gemeinsam prüfen', show: (label: string) => `${label} anzeigen`, more: 'Weitere Angaben anzeigen', technical: 'Technische Details', target: 'Ziel', audience: 'Audience', permissions: 'Berechtigungen', hash: 'Befehls-Hash', adapter: 'Adapter', program: 'Programmversion', untested: 'Version nicht getestet', untestedNote: 'Der Adapter wurde mit dieser Programmdatei nicht geprüft und liest den Befehl nach dem Programmnamen.', programHash: 'Programm-Hash', requested: 'Mit „laut Anfrage“ markierte Werte gibt die anfragende Anwendung an; diese Freigabe bindet sie nicht.' }
  : { language: 'Deutsch', exactCommand: 'Exact command', jsonArgument: 'JSON argument', arguments: 'Arguments', rawCommand: 'Exact command as one line', permission: 'Requested permission', requestedBy: 'Requested by', owner: 'Owner', unregistered: 'Not registered at this IdP', submittedBy: 'Submitted via delegation by', validity: 'Validity', expires: 'Valid until', runAs: 'Run as', batch: 'Part of a batch request', reviewBatch: 'Review together', show: (label: string) => `Show ${label.charAt(0).toLowerCase()}${label.slice(1)}`, more: 'Show more details', technical: 'Technical request details', target: 'Target', audience: 'Audience', permissions: 'Permissions', hash: 'Command hash', adapter: 'Adapter', program: 'Program version', untested: 'Version not tested', untestedNote: 'The adapter was not checked against this program file; it reads the command by the program name.', programHash: 'Program hash', requested: 'Values marked "as requested" are stated by the requesting application; this approval does not bind them.' })

const detailsSummary = computed(() => {
  const details = registry.value?.details ?? []
  return details.length === 1 ? text.value.show(localized(details[0]!.label)) : text.value.more
})

function localized(value: LocalizedText): string {
  return value[language.value]
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(props.german ? 'de-AT' : 'en-GB')
}
</script>

<template>
  <section class="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-4" data-grant-card>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 v-if="line.kind === 'registry'" class="text-xl font-semibold break-words">
          <span data-binding-line="registry">{{ line.text }}</span><GrantRequestedMarker v-if="line.requested" :german="german" />
        </h2>
        <template v-else>
          <p class="text-xs text-muted mb-1 flex items-center gap-2">
            {{ line.kind === 'command' ? text.exactCommand : text.permission }}
            <span v-if="line.shell" class="rounded border border-default px-1">via {{ line.shell }}</span>
          </p>
          <pre
            v-if="!structure"
            class="font-mono text-sm rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-words"
            style="background-color: #0b1220; color: #4ade80;"
            :data-binding-line="line.kind"
          >{{ line.text }}</pre>
        </template>
      </div>
      <button type="button" class="shrink-0 text-xs underline" @click="$emit('language', !german)">
        {{ text.language }}
      </button>
    </div>

    <!-- Below the header row, so long arguments use the full card width. -->
    <div v-if="structure" class="-mt-2 rounded border border-default bg-default px-3 py-2 space-y-3" data-binding-line="command">
      <p class="font-mono text-sm font-semibold break-all" data-command-head>
        {{ [structure.program, ...structure.subcommands].join(' ') }}
      </p>
      <div v-for="(block, index) in blocks" :key="index" :data-command-block="block.kind">
        <p class="text-xs text-muted">
          {{ block.kind === 'object' ? (block.option ?? text.jsonArgument) : text.arguments }}
        </p>
        <dl v-if="block.kind === 'object'" class="mt-1 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-xs">
          <template v-for="entry in block.entries" :key="entry.key">
            <dt class="text-muted break-all" :class="{ 'col-span-2': entry.entries?.length }">
              {{ entry.key }}
            </dt>
            <dd v-if="entry.entries?.length" class="col-span-2 ml-1 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-l border-default pl-3">
              <template v-for="inner in entry.entries" :key="inner.key">
                <span class="text-muted break-all">{{ inner.key }}</span>
                <span class="break-all">{{ inner.value }}</span>
              </template>
            </dd>
            <dd v-else class="break-all">
              {{ entry.value }}
            </dd>
          </template>
        </dl>
        <ul v-else class="mt-1 space-y-0.5 font-mono text-xs">
          <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="break-all">
            {{ item }}
          </li>
        </ul>
      </div>
    </div>

    <template v-if="registry">
      <p v-if="registry.statement" class="font-medium">
        {{ localized(registry.statement) }}<GrantRequestedMarker v-if="registry.statement.requested" :german="german" />
      </p>
      <p v-if="registry.allows">
        {{ localized(registry.allows) }}<GrantRequestedMarker v-if="registry.allows.requested" :german="german" />
      </p>
      <p v-if="registry.does_not_allow" class="text-sm text-muted">
        {{ localized(registry.does_not_allow) }}<GrantRequestedMarker v-if="registry.does_not_allow.requested" :german="german" />
      </p>
      <dl v-if="registry.facts.length" class="space-y-2 text-sm" data-registry-facts>
        <div v-for="fact in registry.facts" :key="fact.label.en" :data-provenance="fact.provenance">
          <dt class="text-muted">
            {{ localized(fact.label) }}<GrantRequestedMarker v-if="fact.provenance === 'requested'" :german="german" />
          </dt>
          <dd v-if="fact.entries" class="font-mono text-xs break-all">
            <span v-for="[key, value] in fact.entries" :key="key" class="block"><span class="font-semibold">{{ key }}</span> {{ value }}</span>
          </dd>
          <dd v-else :class="fact.format === 'code' ? 'font-mono break-all' : 'break-words'">
            {{ fact.value }}
          </dd>
        </div>
      </dl>
      <div v-if="exactCommand" data-exact-command>
        <p class="text-sm text-muted">
          {{ text.exactCommand }}
        </p>
        <pre class="mt-1 font-mono text-xs rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-words" style="background-color: #0b1220; color: #4ade80;">{{ exactCommand.text }}</pre>
      </div>
      <details v-if="registry.details.length || registry.details_note">
        <summary class="cursor-pointer text-sm">
          {{ detailsSummary }}<GrantRequestedMarker v-if="registry.details.some(detail => detail.provenance === 'requested')" :german="german" />
        </summary>
        <dl class="mt-3 space-y-2 text-xs">
          <div v-for="detail in registry.details" :key="detail.label.en" :data-provenance="detail.provenance">
            <dt v-if="registry.details.length > 1 || !detail.entries" class="text-muted">
              {{ localized(detail.label) }}<GrantRequestedMarker v-if="detail.provenance === 'requested'" :german="german" />
            </dt>
            <template v-if="detail.entries">
              <div v-for="[key, value] in detail.entries" :key="key">
                <dt class="font-mono font-semibold">
                  {{ key }}
                </dt>
                <dd class="font-mono break-all">
                  {{ value }}
                </dd>
              </div>
            </template>
            <dd v-else :class="detail.format === 'code' ? 'font-mono break-all' : 'break-words'">
              {{ detail.value }}
            </dd>
          </div>
        </dl>
        <p v-if="registry.details_note" class="mt-3 text-xs text-muted">
          {{ localized(registry.details_note) }}
        </p>
      </details>
      <p v-if="showsRequested" class="text-xs text-muted" data-requested-note>
        {{ text.requested }}
      </p>
    </template>

    <dl class="space-y-2 text-sm border-t border-default pt-3" data-idp-facts>
      <div>
        <dt class="text-muted">
          {{ text.requestedBy }}
        </dt>
        <dd class="font-semibold break-words">
          {{ requesterName }}
        </dd>
        <dd v-if="requesterName !== request.requester" class="font-mono text-xs text-dimmed break-all">
          {{ request.requester }}
        </dd>
        <dd v-if="requester?.owner" class="text-xs break-all">
          {{ text.owner }}: {{ requester.owner }}
        </dd>
        <dd v-if="!requester" class="text-xs text-warning">
          {{ text.unregistered }}
        </dd>
      </div>
      <div v-if="request.submitted_by">
        <dt class="text-muted">
          {{ text.submittedBy }}
        </dt>
        <dd class="font-mono text-xs break-all">
          {{ request.submitted_by.delegate }}
        </dd>
      </div>
      <div>
        <dt class="text-muted">
          {{ text.validity }}
        </dt>
        <dd>{{ validity }}</dd>
        <dd v-if="grant.expires_at" class="text-xs text-muted">
          {{ text.expires }} {{ formatTime(grant.expires_at) }}
        </dd>
      </div>
      <div v-if="program?.version_tested === false" data-version-untested>
        <dt class="text-muted">
          {{ text.program }}
        </dt>
        <dd class="font-semibold text-warning">
          {{ text.untested }}
        </dd>
        <dd class="text-xs text-muted">
          {{ text.untestedNote }}
        </dd>
      </div>
      <div v-if="request.run_as">
        <dt class="text-muted">
          {{ text.runAs }}
        </dt>
        <dd class="font-mono">
          {{ request.run_as }}
        </dd>
      </div>
      <div v-if="batchPath">
        <dt class="text-muted">
          {{ text.batch }}
        </dt>
        <dd>
          <a :href="batchPath" class="underline">{{ text.reviewBatch }} →</a>
        </dd>
      </div>
    </dl>

    <GrantClaims :request="request" :german="german" />

    <details>
      <summary class="cursor-pointer text-sm">
        {{ text.technical }}
      </summary>
      <dl class="mt-2 space-y-2 text-xs">
        <div v-if="command && (line.kind !== 'command' || structure) && !exactCommand" data-raw-command>
          <dt class="text-muted">
            {{ structure ? text.rawCommand : text.exactCommand }}
          </dt>
          <dd class="font-mono whitespace-pre-wrap break-all select-all">
            {{ command.text }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ text.target }} · {{ text.audience }}
          </dt>
          <dd class="font-mono break-all">
            {{ request.target_host }} · {{ request.audience }}
          </dd>
        </div>
        <div v-if="request.permissions?.length">
          <dt class="text-muted">
            {{ text.permissions }}
          </dt>
          <dd class="font-mono break-all">
            {{ request.permissions.join(' · ') }}
          </dd>
        </div>
        <div v-for="detail in cliDetails" :key="`${detail.cli_id}:${detail.operation_id}:${detail.permission}`">
          <dt class="text-muted">
            {{ detail.cli_id }} · {{ detail.operation_id }} · {{ detail.risk }}{{ detail.constraints?.exact_command ? ' · exact-only' : '' }}
          </dt>
          <dd class="break-all">
            {{ detail.display }}
          </dd>
          <dd class="font-mono break-all">
            {{ detail.permission }}
          </dd>
          <dd class="font-mono break-all text-dimmed">
            {{ formatCliResourceChain(detail) }}
          </dd>
        </div>
        <div v-if="request.cmd_hash">
          <dt class="text-muted">
            {{ text.hash }}
          </dt>
          <dd class="font-mono break-all">
            {{ request.cmd_hash }}
          </dd>
        </div>
        <div v-if="program">
          <dt class="text-muted">
            {{ text.programHash }}
          </dt>
          <dd class="font-mono break-all">
            {{ program.sha256 }}
          </dd>
        </div>
        <div v-if="request.execution_context?.adapter_digest">
          <dt class="text-muted">
            {{ text.adapter }}
          </dt>
          <dd class="font-mono break-all">
            {{ request.execution_context.adapter_id }} · {{ request.execution_context.adapter_digest }}
          </dd>
        </div>
      </dl>
    </details>
  </section>
</template>
