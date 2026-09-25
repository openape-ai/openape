<template>
  <UApp>
    <NuxtPage />
    <OpenApeReportLink product="troop" :enabled="useRuntimeConfig().public.issueReportingEnabled" />
  </UApp>
</template>
