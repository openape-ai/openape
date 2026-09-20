# OpenApe Docs

Documentation site for the OpenApe ecosystem — [docs.openape.ai](https://docs.openape.ai)

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

## App guides and Pods

`node apps/docs/scripts/aggregate-guides.mjs` (from the repository root) replaces
`content/5.apps/` and `public/guides/`. Never edit generated pages directly.
Web app guides use the stories distributed by `compose/distribute-docs.mjs`.
Pods is a native Electron app and uses `apps/openape-pods/docs/handbook.json`
instead. Its English online and offline text shares the same section renderer;
`handbook.de.json` retains the German offline edition. Both editions must have
matching chapter IDs. Missing images fail aggregation before output is deleted.

To update Pods, edit both JSON editions and refresh only synthetic screenshots:

```bash
# Run from the repository root after the normal toolchain setup and prebuild.
pnpm --filter @openape/pods build
pnpm --filter @openape/pods package:mac
pnpm --filter @openape/pods exec vitest run --config vitest.electron.config.ts e2e/handbook.test.ts -t 'captures current'
pnpm --filter @openape/pods handbook --refresh-images
node apps/docs/scripts/aggregate-guides.mjs
node --test scripts/aggregate-guides.test.mjs
pnpm --filter @openape/pods exec vitest run --config vitest.electron.config.ts e2e/handbook.test.ts -t 'renders complete'
pnpm --filter docs build
```

The capture fixture creates an isolated temporary profile and seeded examples.
It does not sign in, call a live model/mail/Telegram service, grant provider
consent, run a task or enable a schedule. Its images illustrate UI state, not live
service acceptance. The ordinary web story distribution does not own or erase
Pods handbook sources/images. Commit generated Markdown and images with inputs.

Inspect `/apps`, `/apps/pods`, all guide images and links on a desktop and narrow
viewport after building. Check that regeneration is stable and that the stated
availability still matches the approved distribution status.

## Deployment

From clean, merged canonical main with the required checks passed:

```bash
pnpm run deploy:docs-site
```

This builds the static site, smoke-tests an amd64 Caddy image, publishes it to
the configured registry and updates the Docs service with health checks and
rollback. Verify `https://docs.openape.ai/apps/pods` afterward. This publishes
only documentation, not a Pods app release.

Deployed at [docs.openape.ai](https://docs.openape.ai).

## License

[MIT](./LICENSE)
