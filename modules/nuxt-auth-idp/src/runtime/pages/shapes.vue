<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useHead, useIdpAuth } from '#imports'
import type { OwnerShapeGrant, OwnerShapeView } from '../server/utils/owner-shapes'

// /shapes — owner-published shapes (issue 1551): publish the adapter of a
// tool you built, see what it declares and which continuing grants bind to
// its digest, remove it again. Only the owner's session reaches this page.

useHead({ title: 'Shapes' })

interface Preview { shape: OwnerShapeView, replaced_digest: string | null, grants_losing_reuse: OwnerShapeGrant[] }

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

async function loadShapes() {
  shapesLoading.value = true
  try {
    shapes.value = await $fetch<OwnerShapeView[]>('/api/shapes?mine=1')
  }
  catch {
    shapes.value = []
  }
  finally {
    shapesLoading.value = false
  }
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
    const result = await $fetch<Preview>(`/api/shapes/${encodeURIComponent(cliId.value)}${dryRun ? '?dry_run=1' : ''}`, { method: 'PUT', body: { toml: toml.value } })
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
    await $fetch(`/api/shapes/${encodeURIComponent(shape.cli_id)}`, { method: 'DELETE' })
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
      <p class="mb-6 text-sm text-muted">
        Shapes of tools you built. Only you see them; the shapes-registry stays the shared source and always wins for the same id. Grants bind to the shape digest.
      </p>
      <UAlert v-if="error" color="error" :title="error" class="mb-4" data-shapes-error />
      <UAlert v-if="success" color="success" :title="success" class="mb-4" data-shapes-success />

      <UCard class="mb-6">
        <template #header>
          <h2 class="text-lg font-semibold">
            Publish a shape
          </h2>
          <p class="text-sm text-muted mt-1">
            Paste or choose the adapter.toml of your tool. Same as <code>apes shapes publish FILE</code>.
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
            Your shapes <span class="text-sm text-muted font-normal">{{ shapes.length }}</span>
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
                <th v-for="head in ['Shape', 'Operations', 'Digest', 'Published', 'Bound grants']" :key="head" class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  {{ head }}
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
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
                    <UBadge color="warning" variant="subtle" size="xs" label="owner" class="ml-1" />
                    <span class="block font-mono text-xs text-muted">executable {{ shape.executable }}</span>
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
                  <td class="px-4 py-3 text-xs">
                    {{ shape.bound_grants.length }} continuing
                    <span v-if="shape.bound_grants.length" class="block font-mono text-muted break-all">{{ requesters(shape.bound_grants).join(', ') }}</span>
                  </td>
                  <td class="px-4 py-3 text-right whitespace-nowrap">
                    <UButton variant="ghost" size="xs" data-shape-show-toml @click="shownToml = shownToml === shape.cli_id ? null : shape.cli_id">
                      TOML
                    </UButton>
                    <UButton variant="ghost" size="xs" color="error" data-shape-remove @click="remove(shape)">
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
                    <p class="text-xs font-medium text-muted uppercase">
                      Grants bound to this digest
                    </p>
                    <p v-if="!shape.bound_grants.length" class="text-xs text-muted">
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
        <p class="p-4 text-xs text-muted">
          Remove: continuing grants on this digest stop being reused at once; exact-command grants are untouched. Agents and brokered sessions never see this page.
        </p>
      </UCard>
    </template>
  </IdpPage>
</template>
