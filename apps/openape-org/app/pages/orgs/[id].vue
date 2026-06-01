<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useOpenApeAuth } from '#imports'

const route = useRoute()
const orgId = computed(() => String(route.params.id))

const { t } = useI18n()
const { user, fetchUser, logout } = useOpenApeAuth()
await fetchUser()

interface Org { id: string, ownerEmail: string, name: string, visionMd: string, budgetMonthlyEur: number, createdAt: number, updatedAt: number }
interface Member { orgId: string, agentEmail: string, agentName: string, role: string, reportsToEmail: string | null, status: string, spawnedAt: number | null, retiredAt: number | null, createdAt: number, spawnIntentId?: string | null, spawnStatus?: string | null, spawnError?: string | null }
interface Objective { id: string, orgId: string, title: string, description: string, status: 'planned' | 'in_progress' | 'done' | 'abandoned', targetDate: number | null, parentId: string | null, createdByEmail: string, createdAt: number, updatedAt: number }
interface Report { id: string, orgId: string, kind: 'daily' | 'weekly' | 'quarterly' | 'alert' | 'adhoc', title: string, bodyMd: string, generatedByEmail: string, createdAt: number }
interface CostSnapshot { orgId: string, day: string, tokensIn: number, tokensOut: number, inferenceCostCents: number, infraCostCents: number, outputArtifactsCount: number, updatedAt: number }

const org = ref<Org | null>(null)
const members = ref<Member[]>([])
const objectives = ref<Objective[]>([])
const reports = ref<Report[]>([])
const snapshots = ref<CostSnapshot[]>([])
const loading = ref(true)
const error = ref('')

useSeoMeta({ title: () => org.value ? `${org.value.name} — ${t('app.title')}` : t('app.title') })

const tabs = computed(() => [
  { value: 'chart', label: t('orgDetail.tab.chart'), icon: 'i-lucide-network' },
  { value: 'objectives', label: t('orgDetail.tab.objectives'), icon: 'i-lucide-target' },
  { value: 'cost', label: t('orgDetail.tab.cost'), icon: 'i-lucide-piggy-bank' },
  { value: 'reports', label: t('orgDetail.tab.reports'), icon: 'i-lucide-file-text' },
  { value: 'settings', label: t('orgDetail.tab.settings'), icon: 'i-lucide-settings' },
])
const activeTab = ref('chart')

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [o, m, oj, r, s] = await Promise.all([
      ($fetch as any)(`/api/orgs/${orgId.value}`),
      ($fetch as any)(`/api/orgs/${orgId.value}/members`),
      ($fetch as any)(`/api/orgs/${orgId.value}/objectives`),
      ($fetch as any)(`/api/orgs/${orgId.value}/reports`),
      ($fetch as any)(`/api/orgs/${orgId.value}/cost-snapshots`),
    ])
    org.value = o
    members.value = m
    objectives.value = oj
    reports.value = r
    snapshots.value = s
  }
  catch (err: any) {
    if (err?.statusCode === 401) { await navigateTo('/login'); return }
    error.value = err?.data?.statusMessage || err?.message || t('orgDetail.error.loadFailed')
  }
  finally {
    loading.value = false
  }
}

watch(user, (u) => { if (u) loadAll() }, { immediate: true })
onMounted(() => { if (!user.value) navigateTo('/login') })

// Settings state — separate refs so we can have dirty-tracking without
// trashing the loaded org object.
const visionDraft = ref('')
const budgetDraft = ref(0)
const settingsSaving = ref(false)
const settingsError = ref('')
const settingsDirty = computed(() => {
  if (!org.value) return false
  return visionDraft.value !== org.value.visionMd || budgetDraft.value !== org.value.budgetMonthlyEur
})

watch(org, (o) => {
  if (o) {
    visionDraft.value = o.visionMd
    budgetDraft.value = o.budgetMonthlyEur
  }
})

async function saveSettings() {
  if (!org.value || !settingsDirty.value) return
  settingsSaving.value = true
  settingsError.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${orgId.value}`, {
      method: 'PATCH',
      body: { vision_md: visionDraft.value, budget_monthly_eur: budgetDraft.value },
    })
    if (org.value) {
      org.value.visionMd = visionDraft.value
      org.value.budgetMonthlyEur = budgetDraft.value
    }
  }
  catch (err: any) {
    settingsError.value = err?.data?.statusMessage || err?.message || t('orgDetail.error.saveFailed')
  }
  finally {
    settingsSaving.value = false
  }
}

// Add-member dialog state
const showAddMember = ref(false)

// Link-agent dialog state (triggered from OrgChart when Owner clicks
// "link agent" on a placeholder row).
const showLinkAgent = ref(false)
const placeholderToLink = ref<string | null>(null)
function onLinkAgent(email: string) {
  placeholderToLink.value = email
  showLinkAgent.value = true
}

// Spawn-agent flow per openape-ai/protocol sp-data-access.md (M4β + M4γ).
//
// On click:
//   1. fetch existing standing delegation grants from id.openape.ai
//      with credentials:'include' — relies on the Owner's IdP session
//      cookie + the CORS+sameSite=none allowlist we set up in M4α-IdP
//   2. find a standing grant matching (delegate=org.openape.ai,
//      audience=troop.openape.ai, scopes ⊇ [troop:spawn-agent])
//   3. if none (M4γ): redirect the browser to id.openape.ai's
//      /grant-cross-sp consent page. The Owner sees the scope card
//      and clicks Approve; IdP creates a standing delegation and
//      bounces back to ?spawn=<email>&grant_id=<id>. The mount-time
//      return-handler then resumes the spawn with that grant_id.
//   4. if found: fetch AuthZ-JWT via /api/grants/{id}/token (still
//      browser, credentials)
//   5. POST { subject_token, grant_id } to org's /spawn endpoint;
//      org server exchanges at troop, calls spawn-intent
//   6. start the 2s polling loop until troop reports active/failed
const spawnError = ref('')
const spawnPollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const pendingSpawnEmail = ref<string | null>(null)

const idpBase = computed(() => (useRuntimeConfig().public as { idpUrl?: string }).idpUrl ?? 'https://id.openape.ai')

interface StandingGrant {
  id: string
  type?: string
  status?: string
  request?: {
    delegate?: string
    audience?: string
    scopes?: string[]
    grant_type?: string
  }
}

async function findStandingGrant(): Promise<StandingGrant | null> {
  // Browser → IdP, credentials:'include' relies on CORS allowlist
  // (set up in PR #522) + sameSite=none on the IdP session cookie.
  const res = await fetch(`${idpBase.value}/api/grants?role=delegator`, { credentials: 'include' })
  if (!res.ok) {
    if (res.status === 401) throw new Error('idp-unauthenticated')
    throw new Error(`idp /api/grants failed: HTTP ${res.status}`)
  }
  const body = await res.json() as { grants?: StandingGrant[] } | StandingGrant[]
  const grants = Array.isArray(body) ? body : (body.grants ?? [])
  return grants.find(g =>
    g.type === 'delegation'
    && g.status === 'approved'
    && g.request?.delegate === 'org.openape.ai'
    && g.request?.audience === 'troop.openape.ai'
    && (g.request?.scopes ?? []).includes('troop:spawn-agent')
    && g.request?.grant_type === 'always',
  ) ?? null
}

async function fetchAuthzJwt(grantId: string): Promise<string> {
  const res = await fetch(`${idpBase.value}/api/grants/${encodeURIComponent(grantId)}/token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`idp /api/grants/${grantId}/token failed: HTTP ${res.status}`)
  const body = await res.json() as { authz_jwt: string }
  return body.authz_jwt
}

async function onSpawnAgent(email: string) {
  if (!org.value) return
  spawnError.value = ''
  pendingSpawnEmail.value = email

  let grant: StandingGrant | null
  try {
    grant = await findStandingGrant()
  }
  catch (err: any) {
    if (err?.message === 'idp-unauthenticated') {
      spawnError.value = t('orgDetail.spawn.idpUnauthenticated')
      return
    }
    spawnError.value = err?.message || t('orgDetail.spawn.failed')
    return
  }

  if (!grant) {
    // M4γ: no standing grant — bounce the Owner through id.openape.ai's
    // consent page. `spawn=<email>` round-trips so the mount handler
    // knows which placeholder to resume; `grant_id=<id>` comes back
    // appended by the IdP on Approve, or `error=access_denied` on Deny.
    const ret = new URL(window.location.href)
    ret.searchParams.set('spawn', email)
    // Clear any stale tokens from a previous round-trip.
    ret.searchParams.delete('grant_id')
    ret.searchParams.delete('error')
    const consent = new URL(`${idpBase.value}/grant-cross-sp`)
    consent.searchParams.set('delegate', 'org.openape.ai')
    consent.searchParams.set('audience', 'troop.openape.ai')
    consent.searchParams.set('scopes', 'troop:spawn-agent')
    consent.searchParams.set('grant_type', 'always')
    consent.searchParams.set('return_to', ret.toString())
    window.location.href = consent.toString()
    return
  }

  await spawnWithGrant(email, grant.id)
}

async function spawnWithGrant(email: string, grantId: string) {
  if (!org.value) return
  let subjectToken: string
  try { subjectToken = await fetchAuthzJwt(grantId) }
  catch (err: any) { spawnError.value = err?.message || t('orgDetail.spawn.failed'); return }

  try {
    await ($fetch as any)(`/api/orgs/${org.value.id}/members/${encodeURIComponent(email)}/spawn`, {
      method: 'POST',
      body: { subject_token: subjectToken, grant_id: grantId },
    })
    await loadAll()
    ensureSpawnPolling()
  }
  catch (err: any) {
    spawnError.value = err?.data?.statusMessage || err?.message || t('orgDetail.spawn.failed')
  }
}

// Return-handler: when the IdP bounces back from /grant-cross-sp it
// appends ?grant_id=<id> (approved) or ?error=access_denied (denied).
// We carried the target member in ?spawn=<email>. On mount, drain
// these query params, surface a deny error if applicable, and resume
// the spawn with the freshly-minted grant.
async function handleConsentReturn() {
  const spawn = String(route.query.spawn ?? '')
  const grantId = String(route.query.grant_id ?? '')
  const consentError = String(route.query.error ?? '')
  if (!spawn) return

  // Strip the round-trip params so a refresh doesn't re-trigger the
  // spawn / replay the error.
  const cleaned = new URL(window.location.href)
  cleaned.searchParams.delete('spawn')
  cleaned.searchParams.delete('grant_id')
  cleaned.searchParams.delete('error')
  window.history.replaceState({}, '', cleaned.toString())

  if (consentError === 'access_denied') {
    spawnError.value = t('orgDetail.spawn.denied')
    return
  }
  if (!grantId) return
  await spawnWithGrant(spawn, grantId)
}

function ensureSpawnPolling() {
  if (spawnPollTimer.value) return
  spawnPollTimer.value = setInterval(async () => {
    const pending = members.value.filter(m => m.spawnStatus === 'pending')
    if (pending.length === 0) {
      if (spawnPollTimer.value) { clearInterval(spawnPollTimer.value); spawnPollTimer.value = null }
      return
    }
    let anyFlipped = false
    for (const m of pending) {
      try {
        const res = await ($fetch as any)(`/api/orgs/${org.value!.id}/members/${encodeURIComponent(m.agentEmail)}/spawn-status`) as { status: string }
        if (res.status === 'active' || res.status === 'failed') anyFlipped = true
      }
      catch { /* keep polling */ }
    }
    if (anyFlipped) await loadAll()
  }, 2000)
}

// Resume polling when the page mounts with already-pending spawns.
watch(members, (ms) => {
  if (ms.some(m => m.spawnStatus === 'pending')) ensureSpawnPolling()
})

onBeforeUnmount(() => {
  if (spawnPollTimer.value) clearInterval(spawnPollTimer.value)
})

// Resume an in-flight cross-SP consent flow once the page + session
// are loaded. Gated on `user` because the spawn POST needs the
// org-session cookie; we just came back from a third-party redirect,
// so first paint may not have the user resolved yet.
watch(user, (u) => {
  if (u && route.query.spawn) void handleConsentReturn()
}, { immediate: true })

// Destroy-org modal
const showDestroy = ref(false)
const destroyConfirm = ref('')
const destroying = ref(false)
const destroyError = ref('')

async function destroyOrg() {
  if (!org.value) return
  if (destroyConfirm.value !== org.value.name) return
  destroying.value = true
  destroyError.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${orgId.value}`, { method: 'DELETE' })
    await navigateTo('/')
  }
  catch (err: any) {
    destroying.value = false
    destroyError.value = err?.data?.statusMessage || err?.message || t('orgDetail.destroy.failed')
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-(--ui-border) px-3 sm:px-6 py-3 flex items-center gap-2 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
      <UButton to="/" variant="ghost" size="sm" icon="i-lucide-arrow-left" :ui="{ base: 'shrink-0' }">
        <span class="hidden sm:inline">{{ $t('orgDetail.backToList') }}</span>
      </UButton>
      <span v-if="org" class="font-semibold truncate flex-1">
        🏛️ {{ org.name }}
      </span>
      <LocaleSwitcher />
      <UButton variant="ghost" size="sm" icon="i-lucide-log-out" :ui="{ base: 'shrink-0' }" @click="logout">
        <span class="hidden md:inline">{{ $t('common.logout') }}</span>
      </UButton>
    </header>

    <main class="px-4 sm:px-6 py-4 sm:py-6 max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <UAlert v-if="error" color="error" :title="error" />

      <UCard v-if="loading">
        <p class="text-muted text-sm">
          {{ $t('common.loading') }}
        </p>
      </UCard>

      <template v-else-if="org">
        <!-- Tabs — pill-style for mobile, icons + text for desktop. -->
        <UTabs v-model="activeTab" :items="tabs" :ui="{ list: 'overflow-x-auto' }" />

        <!-- Tab content panes -->
        <div v-show="activeTab === 'chart'" class="space-y-4">
          <div class="flex justify-end">
            <UButton color="primary" size="sm" icon="i-lucide-user-plus" @click="showAddMember = true">
              {{ $t('chart.addMember') }}
            </UButton>
          </div>
          <UAlert v-if="spawnError" color="error" :title="spawnError" />
          <OrgChart :members="members" :owner-email="org.ownerEmail" @link-agent="onLinkAgent" @spawn-agent="onSpawnAgent" />
          <AddMemberDialog
            v-model:open="showAddMember"
            :org-id="org.id"
            :existing-members="members"
            @saved="loadAll"
          />
          <LinkAgentDialog
            v-model:open="showLinkAgent"
            :org-id="org.id"
            :placeholder-email="placeholderToLink"
            @saved="loadAll"
          />
        </div>

        <div v-show="activeTab === 'objectives'">
          <ObjectivesKanban :org-id="org.id" :objectives="objectives" @changed="loadAll" />
        </div>

        <div v-show="activeTab === 'cost'">
          <CostDashboard :snapshots="snapshots" :budget-monthly-eur="org.budgetMonthlyEur" />
        </div>

        <div v-show="activeTab === 'reports'">
          <ReportsInbox :reports="reports" />
        </div>

        <div v-show="activeTab === 'settings'" class="space-y-5">
          <UCard>
            <template #header>
              <h3 class="font-semibold">
                {{ $t('settings.vision.title') }}
              </h3>
              <p class="text-xs text-muted mt-1">
                {{ $t('settings.vision.hint') }}
              </p>
            </template>
            <UTextarea v-model="visionDraft" :rows="10" autoresize class="w-full font-mono text-sm" :ui="{ base: 'w-full' }" :placeholder="$t('settings.vision.placeholder')" />
          </UCard>

          <UCard>
            <template #header>
              <h3 class="font-semibold">
                {{ $t('settings.budget.title') }}
              </h3>
              <p class="text-xs text-muted mt-1">
                {{ $t('settings.budget.hint') }}
              </p>
            </template>
            <UInput v-model.number="budgetDraft" type="number" :min="0" :max="1000000" size="lg" class="w-full">
              <template #trailing>
                <span class="text-muted">€/Mo</span>
              </template>
            </UInput>
          </UCard>

          <UAlert v-if="settingsError" color="error" :title="settingsError" />

          <div v-if="settingsDirty" class="sticky bottom-4 flex justify-end z-10">
            <UButton color="primary" size="lg" :loading="settingsSaving" icon="i-lucide-save" @click="saveSettings">
              {{ $t('common.save') }}
            </UButton>
          </div>

          <section class="mt-8 pt-6 border-t border-red-500/20">
            <h3 class="text-sm font-medium text-red-400 mb-1">
              {{ $t('settings.danger.title') }}
            </h3>
            <p class="text-xs text-muted mb-3">
              {{ $t('settings.danger.hint') }}
            </p>
            <UButton color="error" variant="soft" icon="i-lucide-trash-2" @click="showDestroy = true">
              {{ $t('settings.danger.button') }}
            </UButton>
          </section>
        </div>

        <UModal v-model:open="showDestroy" :ui="{ content: 'sm:max-w-md' }">
          <template #content>
            <div class="p-5 space-y-4">
              <h3 class="text-lg font-semibold">
                {{ $t('settings.danger.modalTitle') }}
              </h3>
              <i18n-t keypath="settings.danger.modalBody" tag="p" class="text-sm">
                <template #name>
                  <span class="font-mono font-semibold">{{ org.name }}</span>
                </template>
              </i18n-t>
              <UFormField :label="$t('settings.danger.typeToConfirm', { name: org.name })">
                <UInput v-model="destroyConfirm" :placeholder="org.name" :disabled="destroying" autocomplete="off" />
              </UFormField>
              <UAlert v-if="destroyError" color="error" :title="destroyError" />
              <div class="flex flex-row-reverse gap-2">
                <UButton
                  color="error"
                  :loading="destroying"
                  :disabled="destroying || destroyConfirm !== org.name"
                  @click="destroyOrg"
                >
                  {{ $t('settings.danger.confirmButton') }}
                </UButton>
                <UButton variant="ghost" :disabled="destroying" @click="showDestroy = false">
                  {{ $t('common.cancel') }}
                </UButton>
              </div>
            </div>
          </template>
        </UModal>
      </template>
    </main>
  </div>
</template>
