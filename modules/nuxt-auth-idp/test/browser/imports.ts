// `#imports` for the browser suite: Nuxt UI's own Vue stubs, with the IdP
// composables the pages use taken from the node suite's test double.
export * from '#nuxt-ui-vue-stubs'
export { __resetNuxtImportsMocks, __setRouteQuery, navigateTo, useHead, useIdpAuth, useRoute } from '../mocks/nuxt-imports'
