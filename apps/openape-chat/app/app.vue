<template>
  <UApp>
    <NuxtPage />
    <ClientOnly>
      <InstallBanner />
      <UpdateAvailable />
    </ClientOnly>
    <OpenApeReportLink product="chat" :enabled="useRuntimeConfig().public.issueReportingEnabled" />
  </UApp>
</template>
