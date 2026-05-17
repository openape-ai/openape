// Function-form titleTemplate has to live in a plugin: nuxt.config head is
// serialized at build time, so a function gets stringified and unhead
// silently treats it as a literal title (same gotcha that hit chat in #210).
// Plugins run at runtime, so the function keeps its identity and unhead
// invokes it correctly.
export default defineNuxtPlugin(() => {
  useHead({
    titleTemplate: (title?: string) => title ? `${title} — OpenApe Troop` : 'OpenApe Troop',
  })
})
