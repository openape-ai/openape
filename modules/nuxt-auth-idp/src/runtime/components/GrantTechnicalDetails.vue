<script setup lang="ts">
import { computed } from 'vue'
import type { LocalizedText } from '@openape/grants'
import type { GrantWithCard } from '../utils/grant-card'
import { grantBindingLine } from '../utils/grant-card'
import { formatCliResourceChain, getCliAuthorizationDetails } from '../utils/cli-grants'
import { unwrapShellCommand } from '../utils/command-display'
import { commandBlocks } from '../utils/command-structure'
import GrantRequestedMarker from './GrantRequestedMarker.vue'

const props = defineProps<{ grant: GrantWithCard, german: boolean }>()
const request = computed(() => props.grant.request)
const registry = computed(() => props.grant.card?.registry)
const program = computed(() => props.grant.card?.program)
const line = computed(() => grantBindingLine(props.grant, props.german ? 'de' : 'en'))
const command = computed(() => unwrapShellCommand(request.value.command))
const blocks = computed(() => line.value.structure ? commandBlocks(line.value.structure) : [])
const details = computed(() => getCliAuthorizationDetails(request.value.authorization_details))
const fields = computed(() => [...registry.value?.facts ?? [], ...registry.value?.details ?? []])
const statements = computed(() => [registry.value?.statement, registry.value?.allows, registry.value?.does_not_allow, registry.value?.details_note].filter((value): value is NonNullable<typeof value> => !!value))
const text = computed(() => props.german
  ? { heading: 'Befehl und technische Details', command: 'Vollständiger Aufruf', arguments: 'Argumente', target: 'Ziel', audience: 'Dienst', permissions: 'Berechtigungen', files: 'Gebundene Dateien', program: 'Programm-Hash', hash: 'Befehls-Hash', adapter: 'Adapter', untested: 'Version nicht getestet', untestedNote: 'Der Adapter wurde mit dieser Programmdatei nicht geprüft und liest den Befehl nach dem Programmnamen.', unshaped: 'Für diesen Aufruf gibt es keine passende strukturierte Beschreibung. Die Freigabe bindet den genauen Aufruf; ihre Gültigkeit wird separat gewählt.' }
  : { heading: 'Command and technical details', command: 'Complete invocation', arguments: 'Arguments', target: 'Target', audience: 'Service', permissions: 'Permissions', files: 'Bound files', program: 'Program hash', hash: 'Command hash', adapter: 'Adapter', untested: 'Version not tested', untestedNote: 'The adapter was not checked against this program file; it reads the command by the program name.', unshaped: 'No matching structured description is available. The approval binds this exact invocation; validity is selected separately.' })
const localized = (value: LocalizedText) => value[props.german ? 'de' : 'en']
</script>

<template>
  <details class="min-w-0 border-t border-default pt-3" data-grant-technical>
    <summary class="cursor-pointer text-xs text-muted">
      {{ text.heading }}
    </summary>
    <div class="mt-3 min-w-0 space-y-4 text-xs">
      <p v-if="details.some(detail => detail.operation_id === '_generic.exec')" class="text-muted" data-unshaped-note>
        {{ text.unshaped }}
      </p>
      <div v-if="command" data-exact-command>
        <p class="mb-1 text-muted">
          {{ text.command }} <span v-if="command.shell">· via {{ command.shell }}</span>
        </p>
        <pre class="rounded bg-elevated p-3 font-mono whitespace-pre-wrap break-all" data-raw-command>{{ command.text }}</pre>
        <ol class="mt-2 space-y-1 font-mono" aria-label="argv">
          <li v-for="(argument, index) in request.command" :key="index" class="flex min-w-0 gap-2">
            <span class="w-5 shrink-0 text-dimmed">{{ index }}</span><code class="min-w-0 whitespace-pre-wrap break-all">{{ JSON.stringify(argument) }}</code>
          </li>
        </ol>
      </div>
      <div v-if="line.structure" class="space-y-3" data-binding-line="command">
        <p class="font-mono font-semibold break-all" data-command-head>
          {{ [line.structure.program, ...line.structure.subcommands].join(' ') }}
        </p>
        <div v-for="(block, index) in blocks" :key="index" :data-command-block="block.kind">
          <p class="text-muted">
            {{ block.kind === 'object' ? (block.option ?? 'JSON') : text.arguments }}
          </p>
          <dl v-if="block.kind === 'object'" class="mt-1 space-y-1 font-mono">
            <div v-for="entry in block.entries" :key="entry.key">
              <dt class="text-muted break-all">
                {{ entry.key }}
              </dt><dd class="whitespace-pre-wrap break-all">
                {{ entry.value }}
              </dd>
            </div>
          </dl>
          <ul v-else class="mt-1 space-y-1 font-mono">
            <li v-for="(item, itemIndex) in block.items" :key="itemIndex" class="break-all">
              {{ item }}
            </li>
          </ul>
        </div>
      </div>
      <p v-else :data-binding-line="line.kind" class="font-mono whitespace-pre-wrap break-all">
        {{ line.text }}<GrantRequestedMarker v-if="line.requested" :german="german" />
      </p>
      <template v-if="registry">
        <p v-for="(statement, index) in statements" :key="index" class="break-words">
          {{ localized(statement) }}<GrantRequestedMarker v-if="statement.requested" :german="german" />
        </p>
        <dl class="space-y-2" data-registry-facts>
          <div v-for="field in fields" :key="field.label.en" :data-provenance="field.provenance">
            <dt class="text-muted">
              {{ localized(field.label) }}<GrantRequestedMarker v-if="field.provenance === 'requested'" :german="german" />
            </dt>
            <dd v-if="field.entries" class="font-mono break-all">
              <span v-for="[key, value] in field.entries" :key="key" class="block">{{ key }} {{ value }}</span>
            </dd>
            <dd v-else class="whitespace-pre-wrap break-all" :class="{ 'font-mono': field.format === 'code' }">
              {{ field.value }}
            </dd>
          </div>
        </dl>
      </template>
      <div v-if="program?.version_tested === false" data-version-untested>
        <p class="font-semibold text-warning">
          {{ text.untested }}
        </p><p class="text-muted">
          {{ text.untestedNote }}
        </p>
      </div>
      <div v-if="request.execution_context?.files?.length" class="space-y-2" data-bound-files>
        <p class="text-muted">
          {{ text.files }}
        </p>
        <dl v-for="file in request.execution_context.files" :key="file.path" class="rounded border border-default p-2 font-mono break-all">
          <dt>{{ file.path }}</dt><dd class="mt-1 text-muted">
            SHA-256: {{ file.sha256 }}
          </dd>
        </dl>
      </div>
      <dl class="space-y-2">
        <div>
          <dt class="text-muted">
            {{ text.target }} · {{ text.audience }}
          </dt><dd class="font-mono break-all">
            {{ request.target_host }} · {{ request.audience }}
          </dd>
        </div>
        <div v-if="request.permissions?.length">
          <dt class="text-muted">
            {{ text.permissions }}
          </dt><dd class="font-mono break-all">
            {{ request.permissions.join(' · ') }}
          </dd>
        </div>
        <div v-for="detail in details" :key="detail.permission">
          <dt class="text-muted">
            {{ detail.cli_id }} · {{ detail.operation_id }} · {{ detail.risk }}{{ detail.constraints?.exact_command ? ' · exact-only' : '' }}
          </dt>
          <dd class="break-all">
            {{ detail.display }}
          </dd><dd class="font-mono break-all">
            {{ detail.permission }}
          </dd><dd class="font-mono break-all">
            {{ formatCliResourceChain(detail) }}
          </dd>
        </div>
        <div v-if="request.cmd_hash">
          <dt class="text-muted">
            {{ text.hash }}
          </dt><dd class="font-mono break-all">
            {{ request.cmd_hash }}
          </dd>
        </div>
        <div v-if="request.execution_context?.argv_hash">
          <dt class="text-muted">
            Argv hash
          </dt><dd class="font-mono break-all">
            {{ request.execution_context.argv_hash }}
          </dd>
        </div>
        <div v-if="request.delegate || request.delegator || request.scopes?.length">
          <dt class="text-muted">
            Delegation
          </dt><dd class="font-mono break-all">
            {{ [request.delegator, request.delegate, ...request.scopes ?? []].filter(Boolean).join(' · ') }}
          </dd>
        </div>
        <div v-if="request.submitted_by">
          <dt class="text-muted">
            Delegation grant
          </dt><dd class="font-mono break-all">
            {{ request.submitted_by.delegation_grant }}
          </dd>
        </div>
        <div v-if="program">
          <dt class="text-muted">
            {{ text.program }}
          </dt><dd class="font-mono break-all">
            {{ program.sha256 }}
          </dd>
        </div>
        <div v-if="request.execution_context?.adapter_digest">
          <dt class="text-muted">
            {{ text.adapter }}
          </dt><dd class="font-mono break-all">
            {{ request.execution_context.adapter_id }} · {{ request.execution_context.adapter_digest }}
          </dd>
        </div>
      </dl>
    </div>
  </details>
</template>
