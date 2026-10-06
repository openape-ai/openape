<script setup lang="ts">
// Dev-only Design-Preview mit Fixture-Daten — die echte /dashboard-Seite ist
// auth-gated, but design iteration (screenshots) needs real pixels without a
// login. The route does not exist in prod builds.
if (!import.meta.dev)
  throw createError({ statusCode: 404, statusMessage: 'Not found' })

const now = Date.now()
const kpis = [
  { id: '1', scope: 'delta-mind', key: 'mail.attention', value: 10, unit: 'mails', link: 'https://outlook.office.com/mail/',  createdAt: now - 2 * 60000, detail: '- **Sakshi Gavhane** — Kontaktanfrage anzeigen (10:50)\n- **Dmytro Danylchyk via LinkedIn** — Dmytro Danylchyk hat Ihnen eine Nachricht gesendet (10:31)\n- **Administrator** — Let`s Encrypt certificates for Administrator have been issued/renewed (08:57)\n- **Gayatri Rajput** — Kontaktanfrage anzeigen (06:50)\n- **GitHub** — Improve code quality, boost Copilot adoption, and stay in control (17:00)\n- **Notification via PayPal** — Ihr PayPal-Konto wird geschlossen (16:24)' },
  { id: '2', link: null, scope: 'docpit', key: 'mail.attention', value: 10, unit: 'mails', createdAt: now - 2 * 60000, detail: '- **UptimeRobot** — [RECOVERED] arnisoft.iurio.com is back online (09:12)\n- **Azure DevOps** — PR #571 wartet auf Review (08:44)\n- _+8 weitere_' },
  { id: '3', link: null, scope: 'hofmann.eco', key: 'mail.attention', value: 0, unit: 'mails', createdAt: now - 2 * 60000, detail: '_Inbox leer — nichts wartet._' },
  { id: '4', scope: 'tasks', key: 'tasks.open', value: 17, unit: 'offen', link: 'https://tasks.openape.ai',  createdAt: now - 2 * 60000, detail: '- Registry-Platte aufräumen · fällig 13.08. (high)\n- IdP-Rate-Limit-Redesign #1073 (med)\n- Buchhaltung Juli abschließen · fällig 15.08. (high)\n- _+14 weitere_' },
  { id: '5', link: null, scope: 'dev/openape', key: 'dev.prs_merged_24h', value: 3, unit: null, createdAt: now - 2 * 60000, detail: '- [#1227](https://git.openape.ai/openape-ai/openape/pulls/1227) fix(plans): activate @tailwindcss/typography\n- [#1230](https://git.openape.ai/openape-ai/openape/pulls/1230) feat(dashboard): KPI store app + ape-kpi CLI\n- [#1231](https://git.openape.ai/openape-ai/openape/pulls/1231) fix(dashboard): move to port 3022' },
]
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <main class="mx-auto max-w-3xl px-4 py-8">
      <KpiBoard :kpis="kpis" />
    </main>
  </div>
</template>
