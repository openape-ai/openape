// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/ui',
    '@nuxt/content',
    'nuxt-og-image',
    'nuxt-llms',
    '@nuxtjs/mcp-toolkit',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  content: {
    // Drop the better-sqlite3 native dep so docs builds/runs in the shared
    // Nuxt container like every other app. Two @nuxt/content databases:
    //  - runtime server DB → libsql (prebuilt binding, pinned by the Dockerfile)
    //  - build-time local DB → Node's built-in node:sqlite (no native build),
    //    otherwise it defaults to better-sqlite3 which the container's
    //    `pnpm install --ignore-scripts` never compiles.
    experimental: {
      nativeSqlite: true,
    },
    database: {
      type: 'libsql',
      url: 'file:./.data/content/contents.db',
    },
    build: {
      markdown: {
        toc: {
          searchDepth: 1,
        },
      },
    },
  },

  experimental: {
    asyncContext: true,
  },

  compatibilityDate: '2024-07-11',

  nitro: {
    prerender: {
      routes: [
        '/',
      ],
      crawlLinks: true,
      autoSubfolderIndex: false,
      // nuxt-og-image 400s on its static og.png routes in clean builds
      // ("Invalid island request hash") — OG images are non-essential,
      // don't fail the whole prerender over them.
      failOnError: false,
    },
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
      },
    },
  },

  icon: {
    provider: 'iconify',
  },

  llms: {
    domain: 'https://docs.openape.ai/',
    title: 'OpenApe Documentation',
    description: 'The security layer for the Agentic Web. DNS-based identity and human-in-the-loop permissions.',
    full: {
      title: 'OpenApe - Full Documentation',
      description: 'Complete documentation for OpenApe Auth, Grants, and the DDISA protocol.',
    },
    sections: [
      {
        title: 'Getting Started',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/getting-started%' },
        ],
      },
      {
        title: 'Ecosystem',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/ecosystem%' },
        ],
      },
      {
        title: 'Security',
        contentCollection: 'docs',
        contentFilters: [
          { field: 'path', operator: 'LIKE', value: '/security%' },
        ],
      },
    ],
  },

  mcp: {
    name: 'OpenApe Docs',
  },
})
