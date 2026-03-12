import type { Browser, BrowserContext, Page, Route } from 'playwright-core'
import type { DefaultAction, GrantedBrowserOptions, GrantRule, LoginAsOptions, Rules } from './types'
import { requestGrant, resolveIdpUrl, waitForApproval } from './grants'
import { evaluateRequest } from './rules'
import { parseRulesFile } from './toml'

export interface GrantedBrowser {
  /** The underlying Playwright browser context */
  context: BrowserContext
  /** Create a new page with route interception */
  newPage: () => Promise<Page>
  /** Login as another user via delegation */
  loginAs: (options: LoginAsOptions) => Promise<Page>
  /** Close the browser */
  close: () => Promise<void>
}

/**
 * Create a grant-aware browser that intercepts routes based on rules.
 */
export async function createGrantedBrowser(options: GrantedBrowserOptions): Promise<GrantedBrowser> {
  // Resolve Playwright — use peer dependency
  let playwright: typeof import('playwright-core')
  try {
    playwright = await import('playwright-core')
  }
  catch {
    try {
      playwright = await import('playwright' as string)
    }
    catch {
      throw new Error('Playwright is required: install playwright or playwright-core')
    }
  }

  // Resolve rules
  let rules: Rules = options.rules || {}
  let defaultAction: DefaultAction = options.defaultAction || 'deny'

  if (options.rulesFile) {
    const parsed = parseRulesFile(options.rulesFile)
    rules = parsed.rules
    if (parsed.default_action)
      defaultAction = parsed.default_action
  }

  // Resolve IdP
  const idpUrl = resolveIdpUrl(options.idp, options.agent)

  // Launch browser
  const launchOptions = options.playwright || {}
  const browser: Browser = await playwright.chromium.launch(launchOptions as Parameters<typeof playwright.chromium.launch>[0])
  const context = await browser.newContext()

  async function setupPageInterception(page: Page): Promise<void> {
    await page.route('**/*', async (route: Route) => {
      const request = route.request()
      const url = request.url()
      const method = request.method()

      // Skip non-HTTP(S) requests (data:, blob:, etc.)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await route.continue()
        return
      }

      const decision = evaluateRequest(url, method, rules, defaultAction)

      if (decision === 'allow') {
        await route.continue()
        return
      }

      if (decision === 'deny') {
        await route.abort('blockedbyclient')
        return
      }

      // grant_required
      if (typeof decision === 'object' && decision.decision === 'grant_required') {
        const granted = await handleGrantRequired(url, method, request, decision.rule, options)
        if (granted) {
          await route.continue()
        }
        else {
          await route.abort('blockedbyclient')
        }
      }
    })
  }

  async function handleGrantRequired(
    url: string,
    method: string,
    request: { postData: () => string | null },
    rule: GrantRule,
    opts: GrantedBrowserOptions,
  ): Promise<boolean> {
    // Ask callback what to do
    if (opts.onGrantRequired) {
      const action = await opts.onGrantRequired(url)
      if (action === 'deny') {
        opts.onGrantDenied?.(url)
        return false
      }
    }

    // Request grant from IdP
    const bodyData = rule.includeBody ? request.postData() : undefined
    const bodyHash = bodyData ? await sha256(bodyData) : undefined

    try {
      const grant = await requestGrant(idpUrl, opts.agent, {
        type: 'browser_access',
        url,
        method,
        bodyHash,
        reason: `Browser access: ${method} ${url}`,
        approval: rule.approval || 'once',
      })

      // Wait for approval
      const approved = await waitForApproval(idpUrl, opts.agent, grant.id)

      if (approved) {
        opts.onGrantApproved?.(url, grant.id)
        return true
      }
      else {
        opts.onGrantDenied?.(url)
        return false
      }
    }
    catch {
      opts.onGrantDenied?.(url)
      return false
    }
  }

  async function newPage(): Promise<Page> {
    const page = await context.newPage()
    await setupPageInterception(page)
    return page
  }

  async function loginAs(loginOpts: LoginAsOptions): Promise<Page> {
    const page = await context.newPage()
    await setupPageInterception(page)

    // Intercept the IdP authorize redirect to inject delegation
    await page.route('**/authorize*', async (route: Route) => {
      const reqUrl = new URL(route.request().url())

      // Add delegation_grant parameter
      reqUrl.searchParams.set('delegation_grant', loginOpts.delegationGrant)

      await route.continue({ url: reqUrl.toString() })
    })

    // Navigate to SP login
    const loginUrl = new URL('/api/login', loginOpts.at)
    loginUrl.searchParams.set('email', loginOpts.as)
    await page.goto(loginUrl.toString())

    // Remove the authorize interceptor after login completes
    await page.unroute('**/authorize*')

    return page
  }

  return {
    context,
    newPage,
    loginAs,
    close: async () => {
      await context.close()
      await browser.close()
    },
  }
}

async function sha256(data: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(data).digest('hex')
}
