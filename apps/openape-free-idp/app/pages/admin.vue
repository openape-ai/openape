<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIdpAuth } from '#imports'

useSeoMeta({ title: 'Domain-Admin' })

const { user, fetchUser } = useIdpAuth()
await fetchUser()

interface AdminStatus {
  email: string
  domain: string
  isRoot: boolean
  isOperator: boolean
  adminTxtName: string | null
}
interface AllowlistEntry {
  clientId: string
  approvedBy: string
  approvedAt: number
}
interface OperatorEntry {
  userEmail: string
  promotedBy: string
  promotedAt: number
}

const status = ref<AdminStatus | null>(null)
const statusLoading = ref(false)
const lastIssuedSecret = ref<string | null>(null)
const lastIssuedTxtName = ref<string | null>(null)
const issuing = ref(false)
const rechecking = ref(false)
const error = ref('')

const allowlist = ref<AllowlistEntry[]>([])
const allowlistLoading = ref(false)
const newClientId = ref('')
const adding = ref(false)

const operators = ref<OperatorEntry[]>([])
const operatorsLoading = ref(false)
const newOperatorEmail = ref('')
const promoting = ref(false)

async function loadStatus() {
  statusLoading.value = true
  error.value = ''
  try {
    status.value = await ($fetch as any)('/api/free-idp/admin/status')
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Status laden fehlgeschlagen'
  }
  finally {
    statusLoading.value = false
  }
}

async function loadAllowlist() {
  if (!status.value?.isRoot && !status.value?.isOperator) return
  allowlistLoading.value = true
  try {
    allowlist.value = await ($fetch as any)('/api/free-idp/admin/allowlist')
  }
  catch {
    allowlist.value = []
  }
  finally {
    allowlistLoading.value = false
  }
}

async function loadOperators() {
  if (!status.value?.isRoot && !status.value?.isOperator) return
  operatorsLoading.value = true
  try {
    operators.value = await ($fetch as any)('/api/free-idp/admin/operators')
  }
  catch {
    operators.value = []
  }
  finally {
    operatorsLoading.value = false
  }
}

async function promoteOperator() {
  const email = newOperatorEmail.value.trim().toLowerCase()
  if (!email) return
  promoting.value = true
  error.value = ''
  try {
    await ($fetch as any)('/api/free-idp/admin/operators', {
      method: 'POST',
      body: { email },
    })
    newOperatorEmail.value = ''
    await loadOperators()
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Operator-Promotion fehlgeschlagen'
  }
  finally {
    promoting.value = false
  }
}

async function demoteOperator(email: string) {
  try {
    await ($fetch as any)(`/api/free-idp/admin/operators/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    })
    await loadOperators()
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Operator-Demote fehlgeschlagen'
  }
}

async function generateSecret() {
  issuing.value = true
  error.value = ''
  try {
    const res = await ($fetch as any)('/api/free-idp/admin/claim-secret', { method: 'POST' })
    lastIssuedSecret.value = res.secret
    lastIssuedTxtName.value = res.txtName
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Secret-Erzeugung fehlgeschlagen'
  }
  finally {
    issuing.value = false
  }
}

async function recheck() {
  rechecking.value = true
  error.value = ''
  try {
    await ($fetch as any)('/api/free-idp/admin/recheck', { method: 'POST' })
    await loadStatus()
    await loadAllowlist()
    await loadOperators()
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Recheck fehlgeschlagen'
  }
  finally {
    rechecking.value = false
  }
}

const bustingCache = ref(false)
const cacheBustResult = ref('')
async function bustDdisaCache() {
  // Drops the IdP's in-memory DDISA cache for the caller's email
  // domain — useful right after editing `_ddisa.{domain}` so the
  // server picks up the new mode/idp without waiting on the 300s
  // positive cache TTL. Gated to root admin server-side.
  bustingCache.value = true
  error.value = ''
  cacheBustResult.value = ''
  try {
    const res = await ($fetch as any)('/api/free-idp/admin/dns-cache/bust', { method: 'POST' })
    cacheBustResult.value = res.wasCached
      ? `DNS-Cache für ${res.domain} verworfen — nächster /authorize resolved frisch.`
      : `DNS-Cache für ${res.domain} war bereits leer — nichts zu tun.`
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'Cache-Bust fehlgeschlagen'
  }
  finally {
    bustingCache.value = false
  }
}

async function addToAllowlist() {
  const clientId = newClientId.value.trim().toLowerCase()
  if (!clientId) return
  adding.value = true
  error.value = ''
  try {
    await ($fetch as any)('/api/free-idp/admin/allowlist', {
      method: 'POST',
      body: { clientId },
    })
    newClientId.value = ''
    await loadAllowlist()
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'SP konnte nicht hinzugefügt werden'
  }
  finally {
    adding.value = false
  }
}

async function removeFromAllowlist(clientId: string) {
  try {
    await ($fetch as any)(`/api/free-idp/admin/allowlist/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    })
    await loadAllowlist()
  }
  catch (err: any) {
    error.value = err?.data?.title || err?.message || 'SP konnte nicht entfernt werden'
  }
}

async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text) }
  catch { /* user can still select-and-copy */ }
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

watch(user, async (u) => {
  if (!u) return
  await loadStatus()
  await loadAllowlist()
  await loadOperators()
}, { immediate: true })
</script>

<template>
  <div class="px-4 py-8 max-w-3xl mx-auto">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Domain-Admin
      </h1>
      <UButton to="/" variant="ghost" size="sm" icon="i-lucide-arrow-left">
        Zurück
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="error"
      class="mb-4"
      :close-button="{ icon: 'i-lucide-x' }"
      @close="error = ''"
    />

    <UCard v-if="statusLoading" class="mb-6">
      <p class="text-muted">
        Status wird geladen…
      </p>
    </UCard>

    <template v-else-if="status">
      <UCard class="mb-6">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">
              Status
            </h2>
            <UButton
              variant="ghost"
              size="xs"
              icon="i-lucide-refresh-cw"
              :loading="rechecking"
              @click="recheck"
            >
              DNS neu prüfen
            </UButton>
          </div>
        </template>

        <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt class="text-muted">
            Email
          </dt>
          <dd class="font-mono">
            {{ status.email }}
          </dd>
          <dt class="text-muted">
            Domain
          </dt>
          <dd class="font-mono">
            {{ status.domain || '—' }}
          </dd>
          <dt class="text-muted">
            Rolle
          </dt>
          <dd>
            <UBadge v-if="status.isRoot" color="primary" variant="subtle">
              Root Admin (DNS-belegt)
            </UBadge>
            <UBadge v-else-if="status.isOperator" color="info" variant="subtle">
              Operator
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle">
              Kein Admin-Status
            </UBadge>
          </dd>
        </dl>

        <div v-if="status.isRoot" class="mt-4 pt-4 border-t border-(--ui-border)">
          <p class="text-sm text-muted mb-2">
            DDISA-Resolver-Cache: nach DNS-Edits zurücksetzen, sonst greift der
            300s-Cache. Nur Root-Admins.
          </p>
          <UButton
            variant="soft"
            size="xs"
            icon="i-lucide-eraser"
            :loading="bustingCache"
            @click="bustDdisaCache"
          >
            DDISA-Cache busten
          </UButton>
          <p v-if="cacheBustResult" class="text-xs text-muted mt-2">
            {{ cacheBustResult }}
          </p>
        </div>
      </UCard>

      <UCard v-if="!status.isRoot && status.adminTxtName" class="mb-6">
        <template #header>
          <h2 class="text-lg font-semibold">
            Root-Admin werden
          </h2>
          <p class="text-sm text-muted mt-1">
            Wenn du <code>{{ status.domain }}</code> via DNS kontrollierst, kannst du Root-Admin werden:
            erzeuge ein zufälliges Claim-Secret, hinterlege es als TXT-Eintrag, klicke "DNS neu prüfen".
          </p>
        </template>

        <div v-if="!lastIssuedSecret">
          <UButton
            color="primary"
            :loading="issuing"
            icon="i-lucide-key-round"
            @click="generateSecret"
          >
            Claim-Secret erzeugen
          </UButton>
          <p class="text-xs text-muted mt-3">
            Ein bestehendes Secret wird dabei ungültig — alte DNS-Records funktionieren nicht mehr.
          </p>
        </div>

        <div v-else class="space-y-3">
          <UAlert color="warning" variant="soft" icon="i-lucide-alert-triangle" title="Einmaliger Wert" description="Dieser Wert wird nicht erneut angezeigt. Kopiere ihn jetzt." />

          <div>
            <p class="text-xs text-muted mb-1">
              TXT-Record-Name
            </p>
            <div class="flex gap-2">
              <code class="block flex-1 p-2 rounded bg-(--ui-bg-elevated) text-sm break-all">{{ lastIssuedTxtName }}</code>
              <UButton variant="ghost" icon="i-lucide-copy" @click="copyToClipboard(lastIssuedTxtName!)" />
            </div>
          </div>

          <div>
            <p class="text-xs text-muted mb-1">
              TXT-Record-Inhalt
            </p>
            <div class="flex gap-2">
              <code class="block flex-1 p-2 rounded bg-(--ui-bg-elevated) text-sm break-all">{{ lastIssuedSecret }}</code>
              <UButton variant="ghost" icon="i-lucide-copy" @click="copyToClipboard(lastIssuedSecret!)" />
            </div>
          </div>

          <p class="text-xs text-muted">
            Nach dem DNS-Edit: TTL abwarten (typisch 60–300s), dann oben auf "DNS neu prüfen" klicken.
          </p>
        </div>
      </UCard>

      <UCard v-if="status.isRoot || status.isOperator">
        <template #header>
          <h2 class="text-lg font-semibold">
            SP-Allowlist (mode=allowlist-admin)
          </h2>
          <p class="text-sm text-muted mt-1">
            Anwendungen, die für <code>{{ status.domain }}</code> zugelassen sind. Bei
            <code>mode=allowlist-admin</code> in deinem DNS bekommen nur diese SPs Assertions.
          </p>
        </template>

        <form class="flex gap-2 mb-4" @submit.prevent="addToAllowlist">
          <UInput
            v-model="newClientId"
            placeholder="z.B. plans.openape.ai"
            class="flex-1"
            :disabled="adding"
          />
          <UButton type="submit" color="primary" :loading="adding" icon="i-lucide-plus">
            Hinzufügen
          </UButton>
        </form>

        <div v-if="allowlistLoading" class="text-muted text-sm">
          Lade…
        </div>
        <div v-else-if="allowlist.length === 0" class="text-muted text-sm">
          Noch keine SPs zugelassen.
        </div>
        <ul v-else class="divide-y divide-(--ui-border)">
          <li
            v-for="entry in allowlist"
            :key="entry.clientId"
            class="py-3 flex items-center justify-between gap-4"
          >
            <div class="min-w-0">
              <code class="font-mono">{{ entry.clientId }}</code>
              <p class="text-xs text-muted">
                hinzugefügt von {{ entry.approvedBy }} · {{ formatDate(entry.approvedAt) }}
              </p>
            </div>
            <UButton
              variant="ghost"
              color="error"
              size="xs"
              icon="i-lucide-trash-2"
              @click="removeFromAllowlist(entry.clientId)"
            />
          </li>
        </ul>
      </UCard>

      <UCard v-if="status.isRoot || status.isOperator" class="mt-6">
        <template #header>
          <h2 class="text-lg font-semibold">
            Operators
          </h2>
          <p class="text-sm text-muted mt-1">
            Mit-Admins für <code>{{ status.domain }}</code>. Operators können dieselben
            Admin-Aktionen wie der Root-Admin durchführen — außer andere Operators
            promoten/demoten. Nur Root-Admins können diese Liste ändern.
          </p>
        </template>

        <form
          v-if="status.isRoot"
          class="flex gap-2 mb-4"
          @submit.prevent="promoteOperator"
        >
          <UInput
            v-model="newOperatorEmail"
            type="email"
            :placeholder="`alice@${status.domain || 'beispiel.com'}`"
            class="flex-1"
            :disabled="promoting"
          />
          <UButton type="submit" color="primary" :loading="promoting" icon="i-lucide-user-plus">
            Promoten
          </UButton>
        </form>

        <p v-else class="text-xs text-muted mb-4">
          Nur ein Root-Admin kann Operators hinzufügen.
        </p>

        <div v-if="operatorsLoading" class="text-muted text-sm">
          Lade…
        </div>
        <div v-else-if="operators.length === 0" class="text-muted text-sm">
          Keine Operators ernannt.
        </div>
        <ul v-else class="divide-y divide-(--ui-border)">
          <li
            v-for="op in operators"
            :key="op.userEmail"
            class="py-3 flex items-center justify-between gap-4"
          >
            <div class="min-w-0">
              <code class="font-mono">{{ op.userEmail }}</code>
              <p class="text-xs text-muted">
                promoted von {{ op.promotedBy }} · {{ formatDate(op.promotedAt) }}
              </p>
            </div>
            <UButton
              v-if="status.isRoot"
              variant="ghost"
              color="error"
              size="xs"
              icon="i-lucide-trash-2"
              @click="demoteOperator(op.userEmail)"
            />
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
