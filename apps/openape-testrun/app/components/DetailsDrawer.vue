<script setup lang="ts">
import type { DetailsSection } from './DocumentBar.vue'
import type { AccessInfo, AuthorType } from '../utils/report-format'
import { nextTick, ref, watch } from 'vue'
import { AUTHOR_LABEL, longDate, shortDate } from '../utils/report-format'
import { copyText } from '../utils/toast'
import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'

export interface DetailsVersion { version: number, author: string, at: number, href: string }
export interface ReportDetails {
  id: string
  title: string
  kindLabel: string
  planStatus: string | null
  author: string
  authorType: AuthorType
  source: string | null
  tags: string[]
  access: AccessInfo
  expiresAt: number | null
  versions: DetailsVersion[] | null
  version: number
  latestVersion: number
  url: string
  versionUrl: string | null
  download: string | null
  metadata: Record<string, string>
  digest: string | null
  isolation: string
  externalImages: string[]
  externalLinks: string[]
}
const props = defineProps<{ open: boolean, section: DetailsSection, details: ReportDetails }>()
const emit = defineEmits<{ close: [] }>()
const body = ref<HTMLElement>()
const tech = ref<HTMLDetailsElement>()

watch(() => props.open, async (open) => {
  if (!open || !props.section) return
  await nextTick()
  if (props.section === 'sec-tech' && tech.value) tech.value.open = true
  body.value?.querySelector(`#${props.section}`)?.scrollIntoView({ block: 'start' })
})
</script>

<template>
  <AppDialog :open="open" title="Details" @close="emit('close')">
    <div ref="body">
      <section class="d-sec" aria-labelledby="d-about">
        <h2 id="d-about" class="sr">
          About
        </h2>
        <p class="d-title">
          {{ details.title }}
        </p>
        <dl class="kv">
          <dt>Category</dt><dd>
            {{ details.kindLabel }}<template v-if="details.planStatus">
              , status {{ details.planStatus }}
            </template>
          </dd>
          <dt>Published by</dt><dd>{{ details.author }} <span v-if="details.authorType" class="hint">({{ AUTHOR_LABEL[details.authorType] }})</span></dd>
          <template v-if="details.versions?.length">
            <dt>First published</dt><dd>{{ longDate(details.versions.at(-1)!.at) }}</dd>
          </template>
          <template v-if="details.source">
            <dt>Source</dt><dd>{{ details.source }}</dd>
          </template>
          <template v-if="details.tags.length">
            <dt>Tags</dt><dd>
              <span class="tag-cloud"><NuxtLink v-for="tag in details.tags" :key="tag" class="tag" :to="{ path: '/reports', query: { tag } }">{{ tag }}</NuxtLink></span>
            </dd>
          </template>
        </dl>
        <p v-if="details.planStatus" class="hint">
          Plan status shows progress. It is not the owner's approval.
        </p>
      </section>
      <section id="sec-access" class="d-sec" aria-labelledby="d-access">
        <h2 id="d-access">
          Who can open it
        </h2>
        <div class="access">
          <AppIcon :name="details.access.icon" /><div><strong>{{ details.access.short }}</strong><span>{{ details.access.long }}</span></div>
        </div>
        <p class="hint">
          {{ details.access.hint }} Only the owner changes access. Categories and tags describe a report; they never grant access.
        </p>
      </section>
      <section id="sec-keep" class="d-sec" aria-labelledby="d-keep">
        <h2 id="d-keep">
          How long it's kept
        </h2>
        <template v-if="details.expiresAt">
          <p><strong>Until {{ longDate(details.expiresAt) }}</strong></p>
          <p class="hint">
            Then it moves to Recently removed, where it can be restored for 30 days.
          </p>
        </template>
        <template v-else>
          <p><strong>Kept permanently</strong></p>
          <p class="hint">
            It stays until the owner removes it.
          </p>
        </template>
      </section>
      <section id="sec-versions" class="d-sec" aria-labelledby="d-ver">
        <h2 id="d-ver">
          Versions
        </h2>
        <p class="hint">
          Published versions never change. A new version is added instead.
        </p>
        <p v-if="!details.versions" class="hint">
          Loading versions…
        </p>
        <div v-else-if="details.versions.length" class="versions">
          <NuxtLink v-for="item in details.versions" :key="item.version" class="ver" :to="item.href" :aria-current="item.version === details.version ? 'page' : undefined">
            <span class="dot" aria-hidden="true" /><span><b>Version {{ item.version }}</b><small>{{ item.author ? `${item.author}, ` : '' }}{{ shortDate(item.at) }}</small></span>
            <span v-if="item.version === details.latestVersion" class="tag-latest">Latest</span><span v-else-if="item.version === details.version" class="hint">Reading</span>
          </NuxtLink>
        </div>
        <div class="copyrow">
          <button class="btn" type="button" @click="copyText(details.url, 'Link copied. It always opens the newest version.')">
            <AppIcon name="link" small />Copy link
          </button>
          <button v-if="details.versionUrl" class="btn quiet" type="button" @click="copyText(details.versionUrl!, `Link to version ${details.version} copied. It never changes.`)">
            Link to version {{ details.version }} only
          </button>
        </div>
        <p class="hint">
          “Copy link” always opens the newest version.
        </p>
      </section>
      <section v-if="details.download" class="d-sec" aria-labelledby="d-dl">
        <h2 id="d-dl">
          Download
        </h2>
        <a class="btn" :href="details.download" download><AppIcon name="download" small />Download version {{ details.version }} as HTML</a>
        <p class="hint">
          A downloaded file opens in your browser without the protection Reports adds.
        </p>
      </section>
      <section v-if="Object.keys(details.metadata).length" class="d-sec" aria-labelledby="d-meta">
        <h2 id="d-meta">
          Publisher data
        </h2>
        <dl class="kv">
          <template v-for="(value, key) in details.metadata" :key="key">
            <dt class="mono">
              {{ key }}
            </dt><dd>{{ value }}</dd>
          </template>
        </dl>
        <p class="hint">
          Extra values the publisher attached. You can filter by them.
        </p>
      </section>
      <section id="sec-tech" class="d-sec">
        <details ref="tech" class="tech">
          <summary>Technical details</summary>
          <dl class="kv">
            <template v-if="details.digest">
              <dt>Fingerprint</dt><dd class="mono">
                SHA-256 {{ details.digest }}
              </dd>
            </template>
            <dt>Isolation</dt><dd>{{ details.isolation }}</dd>
            <template v-if="details.externalImages.length">
              <dt>External images</dt><dd class="mono">
                <span v-for="url in details.externalImages" :key="url" class="line">{{ url }}</span>
              </dd>
            </template>
            <template v-if="details.externalLinks.length">
              <dt>Document links</dt><dd>
                <a v-for="url in details.externalLinks" :key="url" class="line link" :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
              </dd>
            </template>
            <dt>Document ID</dt><dd class="mono">
              {{ details.id }}
            </dd>
          </dl>
        </details>
      </section>
    </div>
  </AppDialog>
</template>

<style scoped>
.d-sec { padding: 16px 0; border-bottom: 1px solid var(--rule); display: grid; gap: 10px; }
.d-sec:first-child { padding-top: 4px; }
.d-sec:last-child { border-bottom: 0; }
.d-sec h2 { font-size: 14px; font-weight: 650; margin: 0; }
.d-title { font-size: 17px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
p { margin: 0; }
.d-sec p, .d-sec dd, .d-sec dt { font-size: 14px; }
.kv { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px 12px; margin: 0; }
.kv dt { color: var(--muted); }
.kv dd { overflow-wrap: anywhere; margin: 0; min-width: 0; }
.access { display: flex; gap: 10px; align-items: flex-start; }
.access .i { margin-top: 2px; color: var(--ink-2); }
.access strong { display: block; }
.versions { display: grid; }
.ver { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: start; padding: 8px 6px; border-radius: var(--radius-s); text-decoration: none; }
.ver:hover { background: var(--paper-2); }
.dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--rule-strong); margin-top: 6px; background: var(--paper); }
.ver[aria-current="page"] .dot { background: var(--accent); border-color: var(--accent); }
.ver b { font-weight: 600; }
.ver small { display: block; color: var(--muted); font-size: 13px; }
.tag-latest { font-size: 12px; color: var(--ok); font-weight: 600; }
.copyrow { display: flex; gap: 8px; flex-wrap: wrap; }
.tech summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.tech[open] summary { margin-bottom: 10px; }
.line { display: block; overflow-wrap: anywhere; }
</style>
