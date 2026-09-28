<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ loginFailed?: boolean }>()
const email = ref('')
const busy = ref(false)
const error = ref(props.loginFailed ? 'Sign-in could not be completed. Please try again with your OpenApe email.' : '')

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
</script>

<template>
  <div class="pods-welcome">
    <header class="welcome-header">
      <a class="welcome-brand" href="/" aria-label="OpenApe Pods home"><span class="brand-mark" aria-hidden="true">p.</span><span>OpenApe <strong>Pods</strong></span></a>
      <a class="workspace-link" href="/workspace">Open workspace <span aria-hidden="true">↗</span></a>
    </header>

    <main class="welcome-main">
      <section class="welcome-story" aria-labelledby="welcome-title">
        <p class="welcome-eyebrow">
          <span aria-hidden="true" /> YOUR WORKSPACE, CONNECTED
        </p>
        <h1 id="welcome-title">
          Your Pods.<br><span>One workspace.</span>
        </h1>
        <p class="welcome-description">
          Keep your automation close. Manage your Pods, review their work and decide what happens next — from your browser.
        </p>
      </section>

      <section class="welcome-access" aria-labelledby="access-title">
        <div class="access-card">
          <span class="access-kicker">LET’S GET TO WORK</span>
          <h2 id="access-title">
            Welcome to Pods
          </h2>
          <p>Sign in with your OpenApe identity to open your workspace.</p>
          <form :aria-busy="busy" @submit.prevent="login">
            <label for="pods-email">Your email</label>
            <input id="pods-email" v-model="email" type="email" name="email" autocomplete="email" placeholder="you@example.com" required :disabled="busy" aria-describedby="login-help">
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
          <div class="access-footer">
            <span aria-hidden="true">↗</span> One identity. Your connected workspace.
          </div>
        </div>
        <p class="desktop-note">
          Pods run on your connected desktop.<br>This workspace brings their controls to your browser.
        </p>
      </section>
      <div class="workspace-outline" aria-label="Workspace capabilities">
        <div><span class="outline-icon" aria-hidden="true">▦</span><p><strong>See the whole picture</strong><span>Your connected desktops and Pods, together.</span></p></div>
        <div><span class="outline-icon" aria-hidden="true">↗</span><p><strong>Keep work moving</strong><span>Manage scripts, schedules and run history.</span></p></div>
        <div><span class="outline-icon" aria-hidden="true">✓</span><p><strong>Stay in control</strong><span>Review permissions and results in one place.</span></p></div>
      </div>
    </main>

    <footer class="welcome-footer">
      <span>OpenApe Pods</span><span>Built for work you can trust.</span><a href="https://openape.ai">About OpenApe <span aria-hidden="true">↗</span></a>
    </footer>
  </div>
</template>

<style scoped>
.pods-welcome { --ink: #24251f; --muted: #65685e; --line: #dfe1d7; --accent: #b13c20; box-sizing: border-box; min-height: 100svh; padding: 0 6vw; background: #f7f8f2; color: var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color-scheme: light; }
.pods-welcome *, .pods-welcome *::before, .pods-welcome *::after { box-sizing: border-box; }
.pods-welcome a { color: inherit; text-decoration: none; }
.pods-welcome a:hover { text-decoration: underline; }
.welcome-header, .welcome-footer { max-width: 1280px; margin: auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.welcome-header { min-height: 110px; border-bottom: 1px solid var(--line); }
.welcome-brand { display: flex; align-items: center; gap: 12px; font-size: 19px; letter-spacing: -.5px; }
.brand-mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: var(--ink); color: #fff; font-size: 28px; font-weight: 750; line-height: 1; padding-bottom: 6px; }
.workspace-link { font-size: 14px; font-weight: 650; }
.workspace-link span { margin-left: 10px; }
.welcome-main { max-width: 1180px; margin: auto; padding: 92px 0 86px; display: grid; grid-template-columns: 1.25fr 1fr; gap: 28px 9%; align-items: start; }
.welcome-eyebrow { display: flex; align-items: center; gap: 9px; margin: 0 0 24px; font-size: 11px; letter-spacing: 1.8px; font-weight: 700; color: var(--muted); }
.welcome-eyebrow > span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
h1 { margin: 0; font-size: clamp(46px, 5.3vw, 76px); line-height: 1.03; letter-spacing: -3.8px; font-weight: 650; }
h1 > span { color: var(--accent); }
.welcome-description { max-width: 460px; margin: 27px 0 0; font-size: 18px; line-height: 1.7; color: var(--muted); }
.welcome-story { grid-column: 1; grid-row: 1; }
.welcome-access { grid-column: 2; grid-row: 1 / span 2; }
.workspace-outline { grid-column: 1; grid-row: 2; display: grid; gap: 20px; }
.workspace-outline > div { display: flex; align-items: center; gap: 16px; }
.outline-icon { display: grid; place-items: center; flex: 0 0 38px; height: 38px; border: 1px solid var(--line); border-radius: 10px; background: #eef0e7; font-size: 22px; }
.workspace-outline p { margin: 0; font-size: 14px; }
.workspace-outline strong, .workspace-outline p > span { display: block; }
.workspace-outline p > span { margin-top: 2px; color: var(--muted); }
.access-card { padding: 37px 34px 0; border: 1px solid var(--line); border-radius: 20px; background: #fff; box-shadow: 0 12px 45px #24251f07; }
.access-kicker { font-size: 10px; font-weight: 700; letter-spacing: 1.6px; color: var(--accent); }
h2 { margin: 13px 0 10px; font-size: 27px; letter-spacing: -.8px; line-height: 1.2; }
.access-card > p { color: var(--muted); font-size: 15px; margin: 0 0 30px; }
form label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 650; }
form input { width: 100%; min-height: 50px; border: 1px solid #c9ccc0; border-radius: 9px; padding: 12px 14px; background: #fff; color: var(--ink); font: inherit; }
form button { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 50px; margin-top: 14px; padding: 13px 16px; border: 0; border-radius: 9px; background: var(--ink); color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
form button:hover { background: #3d4134; }
form button:disabled { opacity: .65; cursor: wait; }
.pods-welcome :focus-visible { outline: 3px solid #b13c20; outline-offset: 4px; }
.login-help { font-size: 12px; line-height: 1.7; color: var(--muted); margin: 17px 0 26px; }
.login-error { padding: 12px; border-radius: 8px; background: #fff0eb; color: #9d2912; font-size: 14px; overflow-wrap: anywhere; }
.access-footer { border-top: 1px solid var(--line); padding: 19px 0; font-size: 11px; color: var(--muted); }
.access-footer > span { margin-right: 7px; }
.desktop-note { text-align: center; font-size: 12px; line-height: 1.7; color: var(--muted); margin: 22px 10px 0; }
.welcome-footer { padding: 24px 0; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
@media (max-width: 760px) {
  .pods-welcome { padding: 0 24px; }
  .welcome-header { min-height: 84px; gap: 12px; }
  .welcome-brand { font-size: 16px; gap: 9px; }
  .workspace-link { font-size: 12px; }
  .workspace-link span { margin-left: 3px; }
  .welcome-main { grid-template-columns: 1fr; gap: 32px; padding: 40px 0; max-width: 500px; }
  .welcome-story, .welcome-access, .workspace-outline { grid-column: 1; grid-row: auto; }
  h1 { font-size: clamp(42px, 9.5vw, 64px); letter-spacing: -2.3px; }
  .welcome-description { font-size: 16px; margin: 22px 0 0; }
  .workspace-outline { gap: 16px; }
  .access-card { padding: 28px 24px 0; }
  .welcome-footer { flex-wrap: wrap; gap: 12px; }
  .welcome-footer > span:nth-child(2) { display: none; }
}
@media (prefers-reduced-motion: no-preference) { form button { transition: background .15s; } }
</style>
