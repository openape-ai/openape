# @openape/unstorage-s3-driver

S3-compatible [unstorage](https://unstorage.unjs.io/) driver that works with providers that don't send XML prolog in responses (Exoscale SOS, MinIO, Wasabi, etc.).

Fork of unstorage's built-in S3 driver with the XML parsing fix applied.

## Why?

The built-in `unstorage` S3 driver expects `<?xml` at the start of ListBucketResult responses. Some S3-compatible providers (notably Exoscale SOS) omit this prolog, causing `Invalid XML` errors.

## Usage

```ts
// nuxt.config.ts
import s3Driver from '@openape/unstorage-s3-driver'

export default defineNuxtConfig({
  nitro: {
    storage: {
      db: {
        driver: s3Driver({
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY,
          endpoint: process.env.S3_ENDPOINT,
          region: process.env.S3_REGION,
          bucket: process.env.S3_BUCKET,
        }),
      },
    },
  },
})
```

Or with unstorage directly:

```ts
import { createStorage } from 'unstorage'
import s3Driver from '@openape/unstorage-s3-driver'

const storage = createStorage({
  driver: s3Driver({
    accessKeyId: '...',
    secretAccessKey: '...',
    endpoint: 'https://sos-at-vie-2.exo.io',
    region: 'at-vie-2',
    bucket: 'my-bucket',
  }),
})
```

## License

MIT
