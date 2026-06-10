<script setup>
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useFetch, useIdpAuth, useRoute } from '#imports'

// /grant-cross-sp — Owner-facing consent page for cross-SP standing
// grants (sp-data-access.md §4).
//
// Receiver SPs (e.g. orgs.openape.ai) redirect the Owner here with:
//   ?delegate=<receiver-domain>      (DDISA domain of the SP that will
//                                     hold the resulting standing grant)
//   ?audience=<provider-domain>      (DDISA domain of the SP that will
//                                     accept the token at /api/cli/exchange)
//   ?scopes=<csv>                    (optional — scopes the receiver wants)
//   ?return_to=<absolute-url>        (where to bounce back to after the
//                                     decision; gets ?grant_id=… or
//                                     ?error=access_denied appended)
//   ?grant_type=once|timed|always    (optional, defaults to 'always')
//
// The page fetches the Provider's scope catalog server-side (the IdP's
// /api/cross-sp-scope-catalog endpoint avoids CORS on the provider)
// and renders a consent card with the verbatim scope descriptions
// the Provider publishes — so the Owner sees the same wording the
// Receiver agreed to at integration time.

// Auth is enforced where it matters: the in-template "signed in?" guard
// (useIdpAuth below) and the session-gated POST /api/grant-cross-sp. Reaching
// here unauthenticated is already prevented upstream — /authorize-cross-sp
// bounces to /login before redirecting to this consent page.
const route = useRoute()
const { user, loading: authLoading, fetchUser } = useIdpAuth()

const delegate = computed(() => String(route.query.delegate ?? '').trim())
const audience = computed(() => String(route.query.audience ?? '').trim())
const requestedScopes = computed(() => {
  const raw = String(route.query.scopes ?? '').trim()
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
})
const returnTo = computed(() => String(route.query.return_to ?? '').trim())
const grantType = computed(() => {
  const t = String(route.query.grant_type ?? 'always').trim()
  return ['once', 'timed', 'always'].includes(t) ? t : 'always'
})

const paramError = computed(() => {
  if (!delegate.value) return 'Missing delegate'
  if (!audience.value) return 'Missing audience'
  if (!returnTo.value) return 'Missing return_to'
  try {
    const url = new URL(returnTo.value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'return_to must be http(s)'
  }
  catch {
    return 'return_to must be a valid absolute URL'
  }
  return ''
})

const { data: catalog, pending: catalogLoading, error: catalogError } = useFetch(
  '/api/cross-sp-scope-catalog',
  {
    query: { audience },
    server: false,
    immediate: false,
    watch: false,
  },
)

// Scope rows to display: intersection of requested-scopes (if any)
// with catalog entries. If the Receiver didn't specify scopes we show
// everything the Provider publishes — the Owner is implicitly granting
// the full surface. The intersection is on `id`; entries the Receiver
// asked for that the Provider doesn't publish are surfaced separately
// so the Owner sees the mismatch instead of silently dropping them.
const scopeRows = computed(() => {
  const all = catalog.value?.scopes ?? []
  if (!requestedScopes.value.length) return all
  return all.filter(s => requestedScopes.value.includes(s.id))
})
const unknownScopes = computed(() => {
  if (!catalog.value?.scopes || !requestedScopes.value.length) return []
  const known = new Set(catalog.value.scopes.map(s => s.id))
  return requestedScopes.value.filter(id => !known.has(id))
})

const processing = ref(false)
const submitError = ref('')

onMounted(() => {
  // Populate the Owner session (useIdpAuth.user starts null until fetched —
  // this page has no auth middleware; the session cookie is read here).
  void fetchUser()
  if (!paramError.value) refresh()
})

async function refresh() {
  await catalog.refresh?.()
}

function buildReturnUrl(extra) {
  const url = new URL(returnTo.value)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return url.toString()
}

async function handleApprove() {
  submitError.value = ''
  processing.value = true
  try {
    const grant = await $fetch('/api/grant-cross-sp', {
      method: 'POST',
      body: {
        delegate: delegate.value,
        audience: audience.value,
        scopes: requestedScopes.value.length ? requestedScopes.value : undefined,
        grant_type: grantType.value,
      },
    })
    await navigateTo(buildReturnUrl({ grant_id: grant.id }), { external: true })
  }
  catch (err) {
    submitError.value = err?.data?.title || err?.statusMessage || err?.message || 'Failed to create grant'
    processing.value = false
  }
}

async function handleDeny() {
  await navigateTo(buildReturnUrl({ error: 'access_denied' }), { external: true })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="space-y-1">
          <h1 class="text-lg font-semibold">
            Grant cross-service access
          </h1>
          <p class="text-xs text-muted">
            <span class="font-mono">{{ delegate }}</span> is asking to act on your behalf at
            <span class="font-mono">{{ audience }}</span>.
          </p>
        </div>
      </template>

      <UAlert v-if="paramError" color="error" :title="paramError" />

      <div v-else-if="authLoading" class="text-center py-6 text-sm text-muted">
        Loading session…
      </div>

      <UAlert
        v-else-if="!user"
        color="warning"
        title="Not signed in"
        description="You need to be signed in to your IdP to approve a cross-service grant."
      />

      <div v-else class="space-y-4">
        <dl class="text-sm space-y-2">
          <div>
            <dt class="text-muted text-xs">
              Delegator
            </dt>
            <dd class="font-mono break-all">
              {{ user.email }}
            </dd>
          </div>
          <div>
            <dt class="text-muted text-xs">
              Receiving service
            </dt>
            <dd class="font-mono break-all">
              {{ delegate }}
            </dd>
          </div>
          <div>
            <dt class="text-muted text-xs">
              Provider
            </dt>
            <dd class="font-mono break-all">
              {{ catalog?.service_name || audience }}
            </dd>
          </div>
          <div>
            <dt class="text-muted text-xs">
              Approval type
            </dt>
            <dd>{{ grantType }}</dd>
          </div>
        </dl>

        <div class="rounded-lg border border-default p-4 space-y-3">
          <div>
            <h3 class="text-sm font-semibold">
              Permissions
            </h3>
            <p class="text-xs text-muted mt-1">
              Verbatim from <span class="font-mono">{{ audience }}/.well-known/openape.json</span>.
            </p>
          </div>

          <div v-if="catalogLoading" class="text-sm text-muted">
            Loading scope catalog…
          </div>
          <UAlert
            v-else-if="catalogError"
            color="error"
            :title="`Could not load scopes from ${audience}`"
            :description="catalogError?.data?.statusMessage || catalogError?.message || ''"
          />
          <ul v-else-if="scopeRows.length" class="space-y-2">
            <li
              v-for="scope in scopeRows"
              :key="scope.id"
              class="text-sm"
            >
              <p class="font-mono text-xs text-emerald-400 break-all">
                {{ scope.id }}
              </p>
              <p class="text-muted mt-0.5">
                {{ scope.description }}
              </p>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">
            No scopes requested — full access to <span class="font-mono">{{ audience }}</span> implied.
          </p>

          <UAlert
            v-if="unknownScopes.length"
            color="warning"
            title="Some requested scopes are not in the Provider's catalog"
          >
            <template #description>
              <ul class="font-mono text-xs mt-1">
                <li v-for="s in unknownScopes" :key="s">
                  {{ s }}
                </li>
              </ul>
            </template>
          </UAlert>
        </div>

        <UAlert
          v-if="submitError"
          color="error"
          :title="submitError"
        />

        <div class="flex gap-3">
          <UButton
            color="success"
            :loading="processing"
            :disabled="!!catalogError"
            block
            class="flex-1"
            @click="handleApprove"
          >
            Approve
          </UButton>
          <UButton
            color="error"
            :loading="processing"
            block
            class="flex-1"
            @click="handleDeny"
          >
            Deny
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
