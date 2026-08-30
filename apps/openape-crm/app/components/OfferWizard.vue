<script setup lang="ts">
import type { Abrechnung } from '#shared/contracts'
import { ABRECHNUNG, WAEHRUNGEN, vertragsArt, vertragsWert } from '#shared/contracts'
import { computed, ref, watch } from 'vue'
import { formatEuro } from '../utils/board'

export interface WizardProduct {
  id: string
  name: string
  standard_price_cents: number
  standard_billing: string
}

export interface WizardLine {
  product_id: string
  price_cents: number
  discount_cents: number
  billing: Abrechnung
}

const props = defineProps<{
  open: boolean
  firma: string
  person: string
  adresse: string
  empfaenger: string
  products: WizardProduct[]
  graphConnected: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  send: [payload: {
    to: string
    start_date: string
    minimum_term_months: number | null
    currency: string
    conditions: string
    positionen: WizardLine[]
  }]
  sign: []
}>()

const steps = ['Kundendaten', 'Produkte', 'Bedingungen', 'Versand', 'Signatur']
const schritt = ref(1)
const waehrung = ref<(typeof WAEHRUNGEN)[number]>('EUR')
const startdatum = ref(new Date().toISOString().slice(0, 10))
const laufzeit = ref<number | null>(12)
const bedingungen = ref('')
const positionen = ref<WizardLine[]>([])

watch(() => props.open, (open) => {
  if (!open) return
  schritt.value = 1
  const first = props.products[0]
  positionen.value = first
    ? [{ product_id: first.id, price_cents: first.standard_price_cents, discount_cents: 0, billing: first.standard_billing as Abrechnung }]
    : []
}, { immediate: true })

const summe = computed(() => vertragsWert({
  positionen: positionen.value.map(p => ({ preis: p.price_cents, rabatt: p.discount_cents })),
}))
const art = computed(() => vertragsArt({ positionen: positionen.value.map(p => ({ abrechnung: p.billing })) }))

function addPos() {
  const p = props.products[0]
  if (!p) return
  positionen.value.push({
    product_id: p.id,
    price_cents: p.standard_price_cents,
    discount_cents: 0,
    billing: p.standard_billing as Abrechnung,
  })
}

function onProduct(i: number, productId: string) {
  const p = props.products.find(x => x.id === productId)
  const line = positionen.value[i]
  if (!p || !line) return
  line.product_id = productId
  line.price_cents = p.standard_price_cents
  line.billing = p.standard_billing as Abrechnung
}

function send() {
  emit('send', {
    to: props.empfaenger,
    start_date: startdatum.value,
    minimum_term_months: laufzeit.value,
    currency: waehrung.value,
    conditions: bedingungen.value,
    positionen: positionen.value,
  })
  schritt.value = 5
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex justify-end bg-[rgba(5,7,10,.6)]" data-wizard @click.self="emit('update:open', false)">
    <div class="flex h-full w-[min(560px,96vw)] flex-col border-l border-[var(--crm-line-2)] bg-[var(--crm-panel)] shadow-2xl">
      <header class="flex items-center gap-2.5 border-b border-[var(--crm-line)] px-[18px] py-3.5">
        <b>Angebot erstellen</b>
        <span class="text-[var(--crm-ink-3)]">{{ firma }}</span>
        <button type="button" class="ms-auto text-[var(--crm-ink-3)]" @click="emit('update:open', false)">
          ×
        </button>
      </header>
      <div class="flex-1 overflow-auto px-[18px] py-4">
        <div class="mb-4 flex gap-1">
          <i
            v-for="n in 5"
            :key="n"
            class="h-[3px] flex-1 rounded-sm"
            :class="n <= schritt ? 'bg-[var(--crm-accent)]' : 'bg-[var(--crm-line-2)]'"
          />
        </div>
        <h3 class="mb-3 text-[15px] font-medium">
          {{ schritt }}. {{ steps[schritt - 1] }}
        </h3>

        <div v-if="schritt === 1" class="space-y-3 text-sm">
          <p class="text-[var(--crm-ink-3)]">
            Aus dem Vorgang übernommen – Firma, Ansprechpartner und Adresse sind vorbefüllt.
          </p>
          <UFormField label="Firma">
            <UInput :model-value="firma" readonly />
          </UFormField>
          <UFormField label="Ansprechpartner">
            <UInput :model-value="person" readonly />
          </UFormField>
          <UFormField label="Adresse">
            <UInput :model-value="adresse" readonly />
          </UFormField>
          <UFormField label="Empfänger">
            <UInput :model-value="empfaenger" readonly />
          </UFormField>
        </div>

        <div v-else-if="schritt === 2" class="space-y-3">
          <div
            v-for="(line, i) in positionen"
            :key="i"
            class="mb-1.5 grid grid-cols-[1fr_86px_76px_106px_26px] items-center gap-1.5"
          >
            <USelect
              :model-value="line.product_id"
              :items="products.map(p => ({ label: p.name, value: p.id }))"
              @update:model-value="onProduct(i, String($event))"
            />
            <UInput v-model.number="line.price_cents" type="number" />
            <UInput v-model.number="line.discount_cents" type="number" />
            <USelect
              v-model="line.billing"
              :items="ABRECHNUNG.map(a => ({ label: a.label, value: a.id }))"
            />
            <button type="button" class="text-[var(--crm-ink-3)]" :disabled="positionen.length < 2" @click="positionen.splice(i, 1)">
              ×
            </button>
          </div>
          <UButton size="xs" variant="ghost" @click="addPos">
            + Position
          </UButton>
          <div class="mt-4 grid grid-cols-3 gap-2">
            <UFormField label="Währung">
              <USelect v-model="waehrung" :items="[...WAEHRUNGEN]" />
            </UFormField>
            <UFormField label="Start">
              <UInput v-model="startdatum" type="date" />
            </UFormField>
            <UFormField label="Mindestlaufzeit (Mon.)">
              <UInput v-model.number="laufzeit" type="number" />
            </UFormField>
          </div>
          <p class="text-[var(--crm-ink-3)]">
            Abgeleitete Vertragsart: <b class="text-[var(--crm-ink)]">{{ art }}</b>
            · Summe <b class="text-[var(--crm-ink)]">{{ formatEuro(summe, waehrung) }}</b>
          </p>
        </div>

        <div v-else-if="schritt === 3">
          <UFormField label="Besondere Bedingungen (Freitext)">
            <UTextarea v-model="bedingungen" :rows="6" placeholder="z. B. Rabatt gilt für die ersten 12 Monate …" />
          </UFormField>
          <p class="mt-3 rounded-lg border border-[var(--crm-line)] p-3 text-sm">
            ▤ Lizenzvertrag_v4.pdf — wird dem Angebot automatisch angehängt
          </p>
        </div>

        <div v-else-if="schritt === 4" class="space-y-3 text-sm">
          <div class="rounded-lg border border-[var(--crm-line)] p-3">
            <b>Angebot</b> — {{ firma }}
            <p class="mt-1 text-[var(--crm-ink-3)]">
              {{ positionen.length }} Position(en) · {{ formatEuro(summe, waehrung) }} · Start {{ startdatum }}
              <template v-if="laufzeit">
                · {{ laufzeit }} Monate
              </template>
            </p>
            <p v-if="bedingungen">
              {{ bedingungen }}
            </p>
          </div>
          <p>
            Versand über Outlook an <b>{{ empfaenger }}</b>. Gleichzeitig entsteht ein Vertrag im Status <b>„offen“</b>.
          </p>
          <p v-if="!graphConnected" class="text-[var(--crm-amber)]">
            Microsoft verbinden, um zu versenden.
          </p>
        </div>

        <div v-else class="space-y-3 text-center">
          <div class="text-3xl">
            ✍
          </div>
          <b>Signaturseite (Stub)</b>
          <p class="text-[var(--crm-ink-3)]">
            Keine EES, keine Zeichnung. Ein Klick setzt den Vertrag auf aktiv.
          </p>
          <UButton data-sign @click="emit('sign')">
            Unterzeichnen
          </UButton>
        </div>
      </div>
      <footer class="flex gap-2 border-t border-[var(--crm-line)] bg-[var(--crm-panel-2)] px-[18px] py-3">
        <UButton v-if="schritt > 1 && schritt < 5" color="neutral" variant="ghost" @click="schritt--">
          Zurück
        </UButton>
        <span class="flex-1" />
        <UButton v-if="schritt < 4" data-next @click="schritt++">
          Weiter
        </UButton>
        <UButton v-if="schritt === 4" data-send :disabled="!graphConnected || !empfaenger || !positionen.length" @click="send">
          Angebot versenden
        </UButton>
      </footer>
    </div>
  </div>
</template>
