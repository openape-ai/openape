<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useHead, useIdpAuth } from '#imports'
import type { ShapeChange, ShapeTier } from '@openape/grants'
import type { AffectedGrant, OverriddenShape, OwnerShapeGrant, OwnerShapeView } from '../server/utils/shape-tiers'

// /shapes — three shape tiers (issues 1551, 1553): personal shapes of tools
// you built, your domain's shapes (written by its root admins and operators)
// and the IdP-wide shapes (read-only here; written with the management
// token). Publish, see what a shape declares and which continuing grants
// bind to its digest, remove it again.

useHead({ title: 'Shapes' })

interface Preview { shape: OwnerShapeView, replaced_digest: string | null, grants_losing_reuse: AffectedGrant[], overrides?: OverriddenShape[] }

const TABS: { scope: ShapeTier, label: string, intro: string }[] = [
  { scope: 'personal', label: 'Personal', intro: 'Shapes of tools you built. Only your own calls and your agents\' calls use them, before any domain or IdP-wide shape for the same program.' },
  { scope: 'domain', label: 'Domain', intro: 'Shapes for every account of your email domain, written by its root admins and operators. They come before IdP-wide shapes; your personal shapes come before them.' },
  { scope: 'instance', label: 'IdP-wide', intro: 'Shapes for every account of this IdP, imported from the shapes-registry with the management token (apes shapes import --scope instance). Read-only here.' },
]
const scope = ref<ShapeTier>('personal')
const tab = computed(() => TABS.find(item => item.scope === scope.value)!)
const history = ref<ShapeChange[] | null>(null)
/** A domain's history answers only its root admins and operators, so it also tells whether this account may write there. */
const writable = computed(() => scope.value === 'personal' || (scope.value === 'domain' && history.value !== null))
function query(dryRun = false) {
  const params = new URLSearchParams({ ...(scope.value === 'personal' ? {} : { scope: scope.value }), ...(dryRun ? { dry_run: '1' } : {}) }).toString()
  return params ? `?${params}` : ''
}
const overriddenGrants = (overrides: OverriddenShape[] = []) => overrides.reduce((sum, override) => sum + override.grants.length, 0)

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const shapes = ref<OwnerShapeView[]>([])
const shapesLoading = ref(false)
const toml = ref('')
const preview = ref<Preview | null>(null)
const busy = ref(false)
const error = ref('')
const success = ref('')
const expanded = ref<Record<string, boolean>>({})
const shownToml = ref<string | null>(null)

/** `id = "…"` inside the `[cli]` table; the server verifies it against the parsed adapter. */
const cliId = computed(() => {
  const start = toml.value.search(/^[ \t]*\[cli\][ \t]*$/m)
  if (start < 0) return null
  const table = toml.value.slice(start).split(/^[ \t]*\[/m)[1] ?? ''
  return /^[ \t]*id[ \t]*=[ \t]*"([^"]+)"/m.exec(table)?.[1] ?? null
})

const shortDigest = (digest: string) => digest.replace(/^(sha256|SHA-256):/i, '').slice(0, 12)
const formatDate = (seconds: number | null) => seconds ? new Date(seconds * 1000).toLocaleDateString('en-GB') : '—'
const requesters = (grants: OwnerShapeGrant[]) => [...new Set(grants.map(grant => grant.requester))]
const riskColor = (risk: string) => risk === 'high' || risk === 'critical' ? 'error' : risk === 'medium' ? 'warning' : 'success'

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadShapes()
})

let loads = 0
async function loadShapes() {
  // Only the newest load may fill the page: a slow answer for a tab left meanwhile is dropped.
  const load = ++loads
  shapesLoading.value = true
  const listUrl = scope.value === 'personal' ? '/api/shapes?mine=1' : `/api/shapes?scope=${scope.value}`
  const [list, changes] = await Promise.allSettled([
    $fetch<OwnerShapeView[]>(listUrl),
    scope.value === 'personal' ? Promise.resolve(null) : $fetch<ShapeChange[]>(`/api/shapes/changes?scope=${scope.value}`),
  ])
  if (load !== loads) return
  shapes.value = list.status === 'fulfilled' ? list.value : []
  history.value = changes.status === 'fulfilled' ? changes.value : null
  shapesLoading.value = false
}

async function selectTab(next: ShapeTier) {
  if (next === scope.value) return
  scope.value = next
  toml.value = ''
  preview.value = null
  expanded.value = {}
  shownToml.value = null
  reset()
  await loadShapes()
}

function reset() {
  error.value = ''
  success.value = ''
}

async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  toml.value = await file.text()
  preview.value = null
  reset()
}

async function put(dryRun: boolean) {
  reset()
  if (!cliId.value) {
    error.value = 'The adapter needs id = "…" in its [cli] table'
    return
  }
  busy.value = true
  try {
    const result = await $fetch<Preview>(`/api/shapes/${encodeURIComponent(cliId.value)}${query(dryRun)}`, { method: 'PUT', body: { toml: toml.value } })
    if (dryRun) {
      preview.value = result
      return
    }
    success.value = `Shape ${result.shape.cli_id} published with digest ${shortDigest(result.shape.digest)}.`
    toml.value = ''
    preview.value = null
    await loadShapes()
  }
  catch (err) {
    error.value = (err as { data?: { title?: string } })?.data?.title ?? (dryRun ? 'Failed to preview the shape' : 'Failed to publish the shape')
  }
  finally {
    busy.value = false
  }
}

async function remove(shape: OwnerShapeView) {
  const continuing = shape.bound_grants.filter(grant => grant.digest_current).length
  if (!confirm(`Remove shape ${shape.cli_id}?\n\n${continuing} continuing grant${continuing === 1 ? '' : 's'} on this digest stop${continuing === 1 ? 's' : ''} being reused at once. Exact-command grants are untouched.`))
    return
  reset()
  try {
    await $fetch(`/api/shapes/${encodeURIComponent(shape.cli_id)}${query()}`, { method: 'DELETE' })
    success.value = `Shape ${shape.cli_id} removed.`
    await loadShapes()
  }
  catch (err) {
    error.value = (err as { data?: { title?: string } })?.data?.title ?? 'Failed to remove the shape'
  }
}
</script>

<template>
  <IdpPage title="Shapes" :subtitle="user?.email" back-to="/account" back-label="Account">
    <div v-if="authLoading" class="text-center text-muted mt-10">
      Loading…
    </div>

    <template v-else>
      <div role="tablist" aria-label="Shape tiers" class="mb-4 flex flex-wrap gap-1 border-b border-default">
        <button
          v-for="item in TABS"
          :key="item.scope"
          type="button"
          role="tab"
          :aria-selected="scope === item.scope"
          class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
          :class="scope === item.scope ? 'border-primary text-highlighted' : 'border-transparent text-muted hover:text-default'"
          :data-shape-tab="item.scope"
          @click="selectTab(item.scope)"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="mb-6 text-sm text-muted" data-shape-tab-intro>
        {{ tab.intro }} Personal and domain grants bind to the shape digest; IdP-wide grants carry over registry updates.
      </p>
      <p v-if="scope === 'domain' && !writable && !shapesLoading" class="mb-4 text-xs text-muted" data-shape-domain-readonly>
        Only root admins and operators of your domain publish domain shapes.
      </p>
      <UAlert v-if="error" color="error" :title="error" class="mb-4" data-shapes-error />
      <UAlert v-if="success" color="success" :title="success" class="mb-4" data-shapes-success />

      <UCard v-if="writable" class="mb-6">
        <template #header>
          <h2 class="text-lg font-semibold">
            Publish a {{ scope === 'domain' ? 'domain' : 'personal' }} shape
          </h2>
          <p class="text-sm text-muted mt-1">
            Paste or choose the adapter.toml of your tool. Same as <code>apes shapes publish FILE{{ scope === 'domain' ? ' --scope domain' : '' }}</code>.
          </p>
        </template>

        <div class="space-y-3">
          <UTextarea
            v-model="toml"
            placeholder="schema = &quot;openape-shapes/v1&quot;&#10;[cli]&#10;id = &quot;mytool&quot;&#10;…"
            :rows="10"
            class="w-full font-mono text-xs"
            data-shape-toml
            @update:model-value="preview = null"
          />
          <input type="file" accept=".toml,text/plain" class="block text-xs text-muted" data-shape-file @change="readFile">

          <div v-if="preview" class="rounded border border-default bg-elevated/60 p-3 text-xs space-y-1" data-shape-preview>
            <p>
              ✔ Parsed cli <strong>{{ preview.shape.cli_id }}</strong> · {{ preview.shape.operations.length }} operation{{ preview.shape.operations.length === 1 ? '' : 's' }} · digest <code>{{ shortDigest(preview.shape.digest) }}</code>
            </p>
            <p v-if="preview.replaced_digest && preview.replaced_digest !== preview.shape.digest" class="text-warning" data-shape-preview-warning>
              ⚠ Replacing digest <code>{{ shortDigest(preview.replaced_digest) }}</code>: {{ preview.grants_losing_reuse.length }} continuing grant{{ preview.grants_losing_reuse.length === 1 ? '' : 's' }} stop{{ preview.grants_losing_reuse.length === 1 ? 's' : '' }} being reused and ask{{ preview.grants_losing_reuse.length === 1 ? 's' : '' }} again.
            </p>
            <p v-else-if="preview.replaced_digest" class="text-muted">
              Same digest as the published version; nothing changes for grants.
            </p>
            <p v-for="override in preview.overrides ?? []" :key="override.cli_id" class="text-warning" data-shape-preview-override>
              ⚠ Overrides the {{ override.tier === 'instance' ? 'IdP-wide' : 'domain' }} shape <code>{{ override.cli_id }}</code>{{ scope === 'domain' ? ' for your domain' : ' for you' }}: {{ override.grants.length }} continuing grant{{ override.grants.length === 1 ? '' : 's' }} of it stop{{ override.grants.length === 1 ? 's' : '' }} covering these calls.
            </p>
            <p v-if="overriddenGrants(preview.overrides) + preview.grants_losing_reuse.length === 0 && !preview.replaced_digest" class="text-muted">
              No existing grant changes.
            </p>
          </div>

          <div class="flex gap-2">
            <UButton variant="outline" :loading="busy" :disabled="!toml.trim() || busy" data-shape-preview-button @click="put(true)">
              Preview
            </UButton>
            <UButton color="primary" :loading="busy" :disabled="!preview || busy" data-shape-publish-button @click="put(false)">
              Publish
            </UButton>
          </div>
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <template #header>
          <h2 class="text-lg font-semibold">
            {{ scope === 'personal' ? 'Your shapes' : scope === 'domain' ? 'Domain shapes' : 'IdP-wide shapes' }} <span class="text-sm text-muted font-normal">{{ shapes.length }}</span>
          </h2>
        </template>

        <div v-if="shapesLoading" class="p-6 text-center text-muted">
          Loading…
        </div>
        <div v-else-if="shapes.length === 0" class="p-6 text-center text-muted" data-shapes-empty>
          No shapes published.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th v-for="head in scope === 'instance' ? ['Shape', 'Operations', 'Digest', 'Updated'] : ['Shape', 'Operations', 'Digest', 'Published', 'Bound grants']" :key="head" class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  {{ head }}
                </th>
                <th v-if="scope !== 'instance'" class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <template v-for="shape in shapes" :key="shape.cli_id">
                <tr class="hover:bg-(--ui-bg-elevated)" :data-shape-row="shape.cli_id">
                  <td class="px-4 py-3 text-sm">
                    <button type="button" class="font-semibold underline-offset-2 hover:underline" data-shape-toggle @click="expanded[shape.cli_id] = !expanded[shape.cli_id]">
                      {{ shape.cli_id }}
                    </button>
                    <UBadge :color="scope === 'instance' ? 'neutral' : 'warning'" variant="subtle" size="xs" :label="tab.label.toLowerCase()" class="ml-1" />
                    <span class="block font-mono text-xs text-muted">executable {{ shape.executable }}</span>
                    <span v-if="shape.published_by" class="block text-xs text-muted break-all">by {{ shape.published_by }}</span>
                  </td>
                  <td class="px-4 py-3 text-sm">
                    {{ shape.operations.length }}
                  </td>
                  <td class="px-4 py-3 text-xs font-mono text-muted">
                    {{ shortDigest(shape.digest) }}
                  </td>
                  <td class="px-4 py-3 text-xs text-muted">
                    {{ formatDate(shape.published_at) }}
                  </td>
                  <td v-if="scope !== 'instance'" class="px-4 py-3 text-xs">
                    {{ shape.bound_grants.length }} continuing
                    <span v-if="shape.bound_grants.length" class="block font-mono text-muted break-all">{{ requesters(shape.bound_grants).join(', ') }}</span>
                  </td>
                  <td v-if="scope !== 'instance'" class="px-4 py-3 text-right whitespace-nowrap">
                    <UButton variant="ghost" size="xs" data-shape-show-toml @click="shownToml = shownToml === shape.cli_id ? null : shape.cli_id">
                      TOML
                    </UButton>
                    <UButton v-if="writable" variant="ghost" size="xs" color="error" data-shape-remove @click="remove(shape)">
                      Remove
                    </UButton>
                  </td>
                </tr>
                <tr v-if="shownToml === shape.cli_id" :data-shape-toml-row="shape.cli_id">
                  <td colspan="6" class="px-4 py-3">
                    <pre class="rounded bg-elevated p-3 font-mono text-xs whitespace-pre-wrap break-all">{{ shape.toml ?? 'The stored adapter text is not available.' }}</pre>
                  </td>
                </tr>
                <tr v-if="expanded[shape.cli_id]" :data-shape-details="shape.cli_id">
                  <td colspan="6" class="px-4 py-3 bg-(--ui-bg-elevated)/40 space-y-3">
                    <p class="text-xs font-medium text-muted uppercase">
                      Operations of {{ shape.cli_id }}
                    </p>
                    <table class="w-full text-xs">
                      <thead>
                        <tr>
                          <th v-for="head in ['id', 'command', 'display', 'action', 'risk']" :key="head" class="text-left px-2 py-1 text-muted font-medium">
                            {{ head }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="operation in shape.operations" :key="operation.id" :data-shape-operation="operation.id">
                          <td class="px-2 py-1 font-mono">
                            {{ operation.id }}
                          </td>
                          <td class="px-2 py-1 font-mono text-muted">
                            {{ [shape.cli_id, ...operation.command].join(' ') }}
                          </td>
                          <td class="px-2 py-1">
                            {{ operation.display }}
                          </td>
                          <td class="px-2 py-1">
                            <UBadge color="neutral" variant="outline" size="xs" :label="operation.action" />
                          </td>
                          <td class="px-2 py-1">
                            <UBadge :color="riskColor(operation.risk)" variant="subtle" size="xs" :label="operation.risk" />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <p v-if="scope !== 'instance'" class="text-xs font-medium text-muted uppercase">
                      Grants bound to this digest
                    </p>
                    <p v-if="scope === 'instance'" class="text-xs text-muted">
                      {{ shape.description }}
                    </p>
                    <p v-else-if="!shape.bound_grants.length" class="text-xs text-muted">
                      None.
                    </p>
                    <ul v-else class="space-y-1 text-xs">
                      <li v-for="grant in shape.bound_grants" :key="grant.id" :data-shape-grant="grant.id">
                        {{ grant.requester }} · operation {{ grant.operation_id }} · {{ grant.grant_type }} · approved {{ formatDate(grant.decided_at) }}
                        <span v-if="!grant.digest_current" class="text-warning">· bound to an earlier digest</span>
                        · <NuxtLink to="/grants" class="underline">
                          open in Grants
                        </NuxtLink>
                      </li>
                    </ul>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-if="writable" class="p-4 text-xs text-muted">
          Remove: continuing grants on this digest stop being reused at once; exact-command grants are untouched. Agents and brokered sessions never see this page.
        </p>
      </UCard>

      <UCard v-if="history" class="mt-6" :ui="{ body: 'p-0' }" data-shape-history>
        <template #header>
          <h2 class="text-lg font-semibold">
            History
          </h2>
          <p class="text-sm text-muted mt-1">
            Every audited write of this tier, newest first. The source commit is what the writer claimed.
          </p>
        </template>
        <p v-if="!history.length" class="p-6 text-center text-sm text-muted">
          No changes recorded yet.
        </p>
        <ul v-else class="divide-y divide-(--ui-border) text-xs">
          <li v-for="(change, index) in history" :key="index" class="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2" :data-shape-change="change.cli_id">
            <span class="text-muted">{{ formatDate(change.created_at) }}</span>
            <span class="font-medium">{{ change.action }}</span>
            <code>{{ change.cli_id }}</code>
            <span class="font-mono text-muted">{{ change.previous_digest ? shortDigest(change.previous_digest) : '—' }} → {{ change.digest ? shortDigest(change.digest) : '—' }}</span>
            <span class="text-muted break-all">{{ change.actor === '_management_' ? 'management token' : change.actor }}</span>
            <span v-if="change.source?.commit" class="font-mono text-muted">{{ change.source.commit.slice(0, 12) }}{{ change.source.dirty ? ' (uncommitted changes)' : '' }}</span>
          </li>
        </ul>
      </UCard>
    </template>
  </IdpPage>
</template>
