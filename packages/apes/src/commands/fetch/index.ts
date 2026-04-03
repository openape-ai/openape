import { defineCommand } from 'citty'
import { getAuthToken } from '../../config'
import { CliError } from '../../errors'

async function doRequest(method: string, url: string, body: string | undefined, contentType: string, raw: boolean, showHeaders: boolean) {
  const token = getAuthToken()
  if (!token) {
    throw new CliError('Not authenticated. Run `apes login` first.')
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: body || undefined,
  })

  if (showHeaders) {
    console.log(`HTTP ${response.status} ${response.statusText}`)
    for (const [key, value] of response.headers.entries()) {
      console.log(`${key}: ${value}`)
    }
    console.log()
  }

  const respContentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (raw || !respContentType.includes('json')) {
    process.stdout.write(text)
  }
  else {
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2))
    }
    catch {
      process.stdout.write(text)
    }
  }

  if (!response.ok) {
    throw new CliError(`HTTP ${response.status} ${response.statusText}`)
  }
}

export const fetchCommand = defineCommand({
  meta: {
    name: 'fetch',
    description: 'Make authenticated HTTP requests',
  },
  subCommands: {
    get: defineCommand({
      meta: {
        name: 'get',
        description: 'GET request with auth token',
      },
      args: {
        url: {
          type: 'positional',
          description: 'URL to fetch',
          required: true,
        },
        raw: {
          type: 'boolean',
          description: 'Output raw response body',
          default: false,
        },
        headers: {
          type: 'boolean',
          description: 'Show response headers',
          default: false,
        },
      },
      async run({ args }) {
        await doRequest('GET', String(args.url), undefined, 'application/json', Boolean(args.raw), Boolean(args.headers))
      },
    }),

    post: defineCommand({
      meta: {
        name: 'post',
        description: 'POST request with auth token',
      },
      args: {
        url: {
          type: 'positional',
          description: 'URL to fetch',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Request body (JSON string)',
        },
        'content-type': {
          type: 'string',
          description: 'Content-Type header',
          default: 'application/json',
        },
        raw: {
          type: 'boolean',
          description: 'Output raw response body',
          default: false,
        },
        headers: {
          type: 'boolean',
          description: 'Show response headers',
          default: false,
        },
      },
      async run({ args }) {
        await doRequest('POST', String(args.url), args.body as string | undefined, String(args['content-type'] || 'application/json'), Boolean(args.raw), Boolean(args.headers))
      },
    }),
  },
})
