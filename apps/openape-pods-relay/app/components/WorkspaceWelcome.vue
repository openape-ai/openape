<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface Release { version: string, minimumSystemVersion: string, verifiedSystemVersion: string, architecture: string, downloadUrl: string }

const props = defineProps<{ loginFailed?: boolean }>()
const email = ref('')
const emailInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref(props.loginFailed ? 'Sign-in could not be completed. Please try again with your OpenApe email.' : '')
const releaseState = ref<'loading' | 'available' | 'unavailable' | 'error'>('loading')
const release = ref<Release | null>(null)

function parseRelease(value: unknown): Release | null {
  if (!value || typeof value !== 'object') throw new Error('Unexpected release response')
  const data = value as Record<string, unknown>
  if (data.available === false) return null
  const { version, minimumSystemVersion, verifiedSystemVersion, architecture, downloadUrl } = data
  if (data.available !== true || typeof version !== 'string' || typeof minimumSystemVersion !== 'string' || typeof verifiedSystemVersion !== 'string' || typeof architecture !== 'string' || typeof downloadUrl !== 'string' || !/^\/(?!\/)/.test(downloadUrl)) throw new Error('Unexpected release response')
  return { version, minimumSystemVersion, verifiedSystemVersion, architecture, downloadUrl }
}

async function loadRelease() {
  releaseState.value = 'loading'
  try {
    const response = await fetch('/api/releases/current', { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Release lookup failed with status ${response.status}`)
    release.value = parseRelease(await response.json())
    releaseState.value = release.value ? 'available' : 'unavailable'
  }
  catch (cause) {
    console.error(cause)
    releaseState.value = 'error'
  }
}

const architectureLabel = (architecture: string) => architecture === 'arm64' ? 'Apple Silicon' : architecture

async function login() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await fetch('/workspace-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim() }),
      redirect: 'error',
    })
    const result = await response.json() as { redirectUrl?: string, message?: string, statusMessage?: string }
    if (!response.ok || !result.redirectUrl) throw new Error(result.message || result.statusMessage || 'Sign-in could not be started. Please try again.')
    window.location.assign(result.redirectUrl)
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Sign-in could not be started. Please try again.'
    busy.value = false
  }
}

onMounted(async () => {
  if (props.loginFailed) emailInput.value?.focus()
  await loadRelease()
})
</script>

<template>
  <div class="pods-welcome">
    <header class="welcome-header">
      <a class="welcome-brand" href="/" aria-label="OpenApe Pods home"><span class="brand-mark" aria-hidden="true">p.</span><span>OpenApe <strong>Pods</strong></span></a>
      <nav class="header-nav" aria-label="Main">
        <a class="nav-secondary" href="#how-it-works">How it works</a>
        <a class="workspace-link" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <main>
      <section class="hero" aria-labelledby="welcome-title">
        <div class="hero-story">
          <p class="eyebrow">
            <span class="status-dot" aria-hidden="true" />Pods for Mac
          </p>
          <h1 id="welcome-title">
            Small automations on your Mac.<br><span>You stay in charge.</span>
          </h1>
          <p class="lead">
            Pods runs scheduled scripts on your Mac with only the access you assign. When a Pod needs your judgement, the question waits for you in Decisions — on your Mac or in the browser.
          </p>

          <div class="download" aria-live="polite" :aria-busy="releaseState === 'loading'">
            <p v-if="releaseState === 'loading'" class="download-status">
              Checking for the latest Mac release…
            </p>
            <template v-else-if="releaseState === 'available' && release">
              <a class="primary" :href="release.downloadUrl">Download for Mac <span aria-hidden="true">↓</span></a>
              <p class="download-meta">
                Version {{ release.version }} · {{ architectureLabel(release.architecture) }} · Verified on macOS {{ release.verifiedSystemVersion }}
              </p>
            </template>
            <p v-else-if="releaseState === 'unavailable'" class="download-status">
              <strong>No Mac download is available right now.</strong> Please check back later.
            </p>
            <template v-else>
              <p class="download-status">
                <strong>Release information could not be loaded.</strong> Check your connection and try again.
              </p>
              <button class="secondary" type="button" @click="loadRelease">
                Try again
              </button>
            </template>
          </div>
          <a class="text-link" href="#sign-in">Already using Pods? Sign in to your workspace <span aria-hidden="true">→</span></a>
        </div>

        <figure class="preview">
          <div class="preview-window" aria-hidden="true">
            <div class="window-bar">
              <i /><i /><i /><span>Pods</span>
            </div>
            <div class="window-body">
              <p class="pane-label">
                AUTOMATIONS · MAP
              </p>
              <div class="map">
                <div class="node service">
                  <b>Mail</b><small>https · mail service</small>
                </div>
                <div class="edge read">
                  <span>reads</span>
                </div>
                <div class="node pod">
                  <b>Sort incoming mail</b><small><span class="pill pods">AI</span> every 15 minutes</small>
                </div>
                <div class="edge channel">
                  <span>asks</span>
                </div>
                <div class="node you">
                  <b>You · Pods inbox</b><small>questions, rules</small>
                </div>
              </div>
              <div class="legend">
                <span><i class="read" />Reads</span><span><i class="channel" />Channels</span>
              </div>

              <p class="pane-label">
                DECISIONS
              </p>
              <div class="item">
                <div class="row">
                  <span class="subj">Newsletter from a new sender</span>
                </div>
                <div class="row">
                  <span class="pill pods">Sort incoming mail</span><span class="meta">you choose one way per case</span>
                </div>
                <div class="opts">
                  <span class="chip">Keep in inbox</span><span class="chip">Archive</span>
                </div>
              </div>
              <div class="item">
                <div class="row">
                  <span class="pill idp">Open approval</span><span class="subj">Sort incoming mail</span>
                </div>
                <div class="row">
                  <span class="meta">Move messages to the archive folder</span>
                </div>
                <div class="opts">
                  <span class="chip idp">Decide at the IdP</span>
                </div>
              </div>
            </div>
          </div>
          <figcaption>Illustration of the Pods app: a Pod reads a mail service and asks you in Decisions. Names are examples.</figcaption>
        </figure>
      </section>

      <section id="how-it-works" class="how" aria-labelledby="how-title">
        <p class="eyebrow">
          <span class="status-dot" aria-hidden="true" />How it works
        </p>
        <h2 id="how-title">
          Automation you can follow and correct.
        </h2>
        <ol class="steps">
          <li class="step">
            <span class="step-number" aria-hidden="true">01</span>
            <h3>Describe the job</h3>
            <p>Create an automation together with Codex, or write the script yourself. Each Pod is one small script that runs on a schedule or when work arrives.</p>
          </li>
          <li class="step">
            <span class="step-number" aria-hidden="true">02</span>
            <h3>Assign only what it needs</h3>
            <p>Services via HTTPS, installed applications, folders and secrets are assigned one by one. A Pod works with what you assigned and nothing more.</p>
          </li>
          <li class="step">
            <span class="step-number" aria-hidden="true">03</span>
            <h3>Decide what matters</h3>
            <p>When a Pod is unsure, it asks you in Decisions. Rights are approved at your identity provider — Pods never approves its own rights.</p>
          </li>
          <li class="step">
            <span class="step-number" aria-hidden="true">04</span>
            <h3>See how work flows</h3>
            <p>Pods hand work to each other through channels. The map shows what each one reads, writes and passes on.</p>
          </li>
        </ol>
      </section>

      <section id="sign-in" class="signin" aria-labelledby="signin-title">
        <div class="signin-story">
          <p class="eyebrow">
            <span class="status-dot" aria-hidden="true" />Workspace
          </p>
          <h2 id="signin-title">
            Already using Pods?
          </h2>
          <p class="signin-lead">
            Your Pods keep running on your Mac. Sign in to review decisions, runs and settings from any browser.
          </p>
        </div>
        <div class="access-card">
          <h3>Sign in to your workspace</h3>
          <form :aria-busy="busy" @submit.prevent="login">
            <label for="pods-email">Your email</label>
            <input id="pods-email" ref="emailInput" v-model="email" type="email" name="email" autocomplete="email" placeholder="you@example.com" required :disabled="busy" aria-describedby="login-help">
            <button type="submit" :disabled="busy">
              {{ busy ? 'Connecting…' : 'Continue with OpenApe' }} <span v-if="!busy" aria-hidden="true">→</span>
            </button>
            <p v-if="error" class="login-error" role="alert">
              {{ error }}
            </p>
            <p id="login-help" class="login-help">
              Your email takes you to the right identity provider. You sign in securely there, then return to your workspace.
            </p>
          </form>
        </div>
      </section>
    </main>

    <footer class="welcome-footer">
      <span>OpenApe Pods</span><span>Built for work you can trust.</span><a href="https://openape.ai">About OpenApe <span aria-hidden="true">↗</span></a>
    </footer>
  </div>
</template>

<style scoped>
.pods-welcome { --bg: #f6f7f4; --sidebar: #ecefe9; --surface: #fff; --text: #243027; --muted: #5d6960; --border: #e0e6dc; --accent: #326747; --accent-hover: #29573b; --tint: #e4eddf; --idp: #5a3fb5; --idp-soft: #e7e0f8; --bad: #b3261e; --bad-soft: #f9dedc; --read: #3b82c4; --service: #2f8f6a; box-sizing: border-box; min-height: 100svh; padding: 0 clamp(20px, 5vw, 64px); background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color-scheme: light; font-synthesis: none; }
.pods-welcome *, .pods-welcome *::before, .pods-welcome *::after { box-sizing: border-box; }
.pods-welcome a { color: inherit; text-decoration: none; }
.pods-welcome a:hover { text-decoration: underline; }
.pods-welcome :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.welcome-header, .welcome-footer, main > section { max-width: 1200px; margin: 0 auto; }

.welcome-header { min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); }
.welcome-brand { display: flex; align-items: center; gap: 11px; font-size: 17px; }
.welcome-brand strong { font-weight: 650; }
.brand-mark { display: grid; place-items: center; width: 32px; height: 32px; padding-right: 3px; border-radius: 9px; background: var(--accent); color: var(--bg); font-size: 24px; font-weight: 700; letter-spacing: -3px; line-height: 1; }
.header-nav { display: flex; align-items: center; gap: 28px; font-size: 14px; font-weight: 600; }
.nav-secondary { color: var(--muted) !important; }
.workspace-link span { margin-left: 6px; }

.eyebrow { display: flex; align-items: center; gap: 9px; margin: 0 0 18px; font-size: 11px; font-weight: 650; letter-spacing: 1.8px; text-transform: uppercase; color: var(--muted); }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 64px; align-items: center; padding: 76px 0 88px; }
h1 { margin: 0; font-size: clamp(38px, 4.6vw, 60px); line-height: 1.06; letter-spacing: -.03em; font-weight: 600; }
h1 > span { color: var(--accent); }
.lead { max-width: 520px; margin: 24px 0 0; font-size: 18px; line-height: 1.65; color: var(--muted); }
.download { display: grid; justify-items: start; gap: 10px; min-height: 92px; margin-top: 34px; }
.download-status { max-width: 460px; margin: 0; font-size: 15px; color: var(--muted); }
.download-status strong { color: var(--text); font-weight: 600; }
.download-meta { margin: 0; font-size: 13px; color: var(--muted); }
.primary, .secondary { display: inline-flex; align-items: center; gap: 12px; min-height: 48px; padding: 12px 20px; border-radius: 8px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.primary { background: var(--accent); color: #fff !important; }
.primary:hover { background: var(--accent-hover); text-decoration: none !important; }
.secondary { min-height: 44px; padding: 8px 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 14px; }
.secondary:hover { background: var(--sidebar); }
.text-link { display: inline-block; margin-top: 18px; font-size: 14px; font-weight: 600; color: var(--accent) !important; }

.preview { margin: 0; min-width: 0; }
.preview-window { overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 18px 50px #24302714; }
.window-bar { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-bottom: 1px solid var(--border); background: var(--sidebar); font-size: 12px; font-weight: 600; color: var(--muted); }
.window-bar i { width: 10px; height: 10px; border-radius: 50%; background: #d3d9cf; }
.window-bar span { margin-left: 10px; }
.window-body { container-type: inline-size; padding: 20px; font-size: 14px; }
.pane-label { margin: 0 0 10px; font-size: 10px; font-weight: 650; letter-spacing: 1.6px; color: var(--muted); }
.legend + .pane-label { margin-top: 22px; }
.map { display: grid; grid-template-columns: minmax(0, 1fr) 52px minmax(0, 1fr) 52px minmax(0, 1fr); align-items: center; padding: 20px 14px; border: 1px solid var(--border); border-radius: 10px; background: #eef2ea; }
.node { min-width: 0; padding: 9px 10px; border: 1.5px solid var(--border); border-radius: 8px; background: var(--surface); overflow-wrap: anywhere; }
.node b { display: block; font-size: 13px; font-weight: 600; line-height: 1.3; }
.node small { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 4px; font-size: 11px; line-height: 1.35; color: var(--muted); }
.node.service { border-color: var(--service); border-radius: 12px; }
.node.pod { border-color: var(--accent); box-shadow: 0 0 0 3px var(--tint); }
.node.you { border-color: transparent; background: var(--tint); }
.edge { position: relative; height: 34px; }
.edge.read { color: var(--read); }
.edge.channel { color: var(--accent); }
.edge::before { content: ''; position: absolute; top: 50%; left: 4px; right: 8px; height: 2px; border-radius: 2px; background: currentColor; }
.edge::after { content: ''; position: absolute; top: calc(50% - 4px); right: 3px; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid currentColor; }
.edge span { position: absolute; left: 0; right: 0; bottom: calc(50% + 5px); text-align: center; font-size: 10px; color: var(--muted); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 10px; font-size: 11px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; vertical-align: -1px; }
.legend .read { background: var(--read); }
.legend .channel { background: var(--accent); }
.item { display: grid; gap: 8px; min-width: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.item + .item { margin-top: 8px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
.subj { font-weight: 600; }
.meta { font-size: 12px; color: var(--muted); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.pill.pods { background: var(--tint); color: var(--accent); }
.pill.idp { background: var(--idp-soft); color: var(--idp); }
.opts { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 5px 11px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); font-size: 12px; }
.chip.idp { border-color: var(--idp); background: var(--idp-soft); color: var(--idp); font-weight: 600; }
.preview figcaption { margin-top: 12px; font-size: 12px; text-align: center; color: var(--muted); }
@container (max-width: 440px) {
  .map { grid-template-columns: minmax(0, 1fr); padding: 14px; }
  .edge { height: 34px; }
  .edge::before { top: 4px; bottom: 9px; left: calc(50% - 1px); right: auto; width: 2px; height: auto; }
  .edge::after { top: auto; bottom: 2px; left: calc(50% - 5px); right: auto; border: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid currentColor; }
  .edge span { left: calc(50% + 10px); right: auto; top: 50%; bottom: auto; transform: translateY(-50%); }
}

h2 { margin: 0; font-size: clamp(26px, 3vw, 34px); line-height: 1.2; letter-spacing: -.02em; font-weight: 600; }
h3 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 600; }
.how { padding: 72px 0; border-top: 1px solid var(--border); }
.steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 32px 0 0; padding: 0; list-style: none; }
.step { padding: 22px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); }
.step-number { display: block; margin-bottom: 14px; font: 600 12px/1 ui-monospace, Menlo, monospace; color: var(--accent); }
.step p { margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: var(--muted); }

.signin { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: 64px; align-items: start; padding: 72px 0 88px; border-top: 1px solid var(--border); }
.signin-lead { max-width: 460px; margin: 16px 0 0; font-size: 17px; line-height: 1.65; color: var(--muted); }
.access-card { padding: 30px 28px 6px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 12px 40px #2430270a; }
.access-card h3 { margin-bottom: 22px; font-size: 20px; letter-spacing: -.01em; }
form label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 650; }
form input { width: 100%; min-height: 50px; padding: 12px 14px; border: 1px solid #c3cbbf; border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; }
form input::placeholder { color: #7a857c; }
form button { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 50px; margin-top: 14px; padding: 13px 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
form button:hover { background: var(--accent-hover); }
form button:disabled { opacity: .65; cursor: wait; }
.login-error { margin: 14px 0 0; padding: 12px; border-radius: 8px; background: var(--bad-soft); color: #8c1d17; font-size: 14px; overflow-wrap: anywhere; }
.login-help { margin: 16px 0 24px; font-size: 12px; line-height: 1.7; color: var(--muted); }

.welcome-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding: 24px 0; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }

@media (max-width: 1100px) {
  .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 960px) {
  .hero { grid-template-columns: minmax(0, 1fr); gap: 44px; padding: 48px 0 64px; }
  .signin { grid-template-columns: minmax(0, 1fr); gap: 28px; padding: 56px 0 64px; }
}
@media (max-width: 600px) {
  .welcome-header { min-height: 72px; }
  .welcome-brand { font-size: 16px; gap: 9px; }
  .nav-secondary { display: none; }
  .lead { font-size: 16px; }
  .how { padding: 56px 0; }
  .steps { grid-template-columns: minmax(0, 1fr); }
  .window-body { padding: 14px; }
  .access-card { padding: 24px 20px 4px; }
  .welcome-footer > span:nth-child(2) { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .primary, .secondary, form button { transition: background .15s; }
}
</style>
