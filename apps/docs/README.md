# OpenApe Docs

Documentation site for the OpenApe ecosystem — [docs.openape.at](https://docs.openape.at)

Built with [Nuxt Content](https://content.nuxt.com/) and [Nuxt UI](https://ui.nuxt.com/).

## Development

```bash
pnpm install
pnpm dev
```

## Content Structure

Documentation pages live in `content/` as Markdown files. The numeric prefixes control ordering:

```
content/
├── index.md                        Landing page
├── 1.getting-started/
│   ├── 1.index.md                  Overview
│   ├── 2.installation.md           Installation guide
│   └── 3.usage.md                  Usage guide
├── 2.ecosystem/
│   ├── 1.index.md                  Ecosystem overview
│   ├── 2.auth.md                   Authentication
│   └── 3.grants.md                 Grants
└── 3.security/
    ├── 1.compliance.md             Compliance
    └── 2.threat-model.md           Threat model
```

To add a new page, create a Markdown file in the appropriate section directory with a numeric prefix for ordering.

## Deployment

```bash
pnpm build
npx vercel deploy --prebuilt --prod
```

Deployed at [docs.openape.at](https://docs.openape.at).

## License

[MIT](./LICENSE)
