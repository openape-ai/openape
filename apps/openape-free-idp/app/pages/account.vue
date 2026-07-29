<script setup lang="ts">
// App override of the module's /account hub: the single entry point for every
// account setting — the dashboard only links here (#462). Includes the
// free-idp-only "Recovery protection" page, whose settings/history endpoints
// live on app level, so the generic module hub cannot link them.

useSeoMeta({ title: 'Account & security' })

const { user } = useIdpAuth()

// Grouped by the question each answers, not by which API happens to serve it:
// proving it's you, who else may act as you, and where you are known.
const groups = [
  {
    title: 'How you sign in',
    sections: [
      { to: '/passkeys', icon: 'i-lucide-key-round', title: 'Passkeys', desc: 'Add or remove the devices you sign in with.' },
      { to: '/ssh-keys', icon: 'i-lucide-terminal', title: 'SSH keys', desc: 'Public keys for signing in with an SSH key.' },
      { to: '/recovery-protection', icon: 'i-lucide-life-buoy', title: 'Recovery protection', desc: 'Vacation shield and the history of recovery attempts.' },
    ],
  },
  {
    title: 'Who acts as you',
    sections: [
      { to: '/agents', icon: 'i-lucide-bot', title: 'Agents', desc: 'The agents that act under your identity.' },
      { to: '/grants', icon: 'i-lucide-badge-check', title: 'Grants', desc: 'What your agents are allowed to do, and where.' },
      { to: '/delegations', icon: 'i-lucide-shield-check', title: 'Delegations', desc: 'Apps acting on your behalf at another service.' },
    ],
  },
  {
    title: 'Where you are known',
    sections: [
      { to: '/connected-services', icon: 'i-lucide-link', title: 'Connected services', desc: 'Apps you approved at sign-in.' },
      { to: '/admin', icon: 'i-lucide-globe', title: 'Domain admin', desc: 'Manage the domains you host identities for.' },
    ],
  },
]

onMounted(async () => {
  if (!user.value)
    await navigateTo('/login')
})
</script>

<template>
  <IdpPage title="Account &amp; security" :subtitle="user?.email" back-to="/" back-label="Your identity">
    <div class="space-y-8">
      <section v-for="group in groups" :key="group.title">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-dimmed">
          {{ group.title }}
        </h2>
        <ul class="space-y-2">
          <li v-for="s in group.sections" :key="s.to">
            <NuxtLink
              :to="s.to"
              class="group flex items-center gap-4 rounded-lg border border-default bg-default p-4 transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UIcon :name="s.icon" class="size-5" />
              </span>
              <span class="min-w-0">
                <span class="block font-medium">{{ s.title }}</span>
                <span class="block text-sm text-muted">{{ s.desc }}</span>
              </span>
              <UIcon
                name="i-lucide-chevron-right"
                class="ml-auto size-5 shrink-0 text-dimmed transition-colors group-hover:text-primary"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </IdpPage>
</template>
