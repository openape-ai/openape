// Function-form titleTemplate has to live in a plugin: nuxt.config head is
// serialized at build time, so a function gets stringified and unhead
// silently treats it as a literal title (PR #210 hit this — every page
// rendered just its own title without the " — OpenApe Chat" suffix).
//
// Plugins run at runtime, so the function keeps its identity and unhead
// invokes it correctly.
export default defineNuxtPlugin(() => {
  useHead({
    titleTemplate: (title?: string) => title ? `${title} — OpenApe Chat` : 'OpenApe Chat',
  })
})
