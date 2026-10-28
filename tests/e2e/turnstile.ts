import { expect, type Page, type Request } from '@playwright/test'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'

// Turnstile in the end-to-end tests (#148).
//
// The form specs (say hello, apply send) use a stand-in for Turnstile's
// script. Under load, the real challenge's requests through the test proxy
// can hang without ever finishing, so a test waiting for a real token timed
// out now and then. Don't put the real token back: retries or longer waits
// would only hide that. What the stand-in leaves out is covered elsewhere:
// - the server rejecting a missing, failed or wrong-action token is tested by
//   the siteverify unit tests (#48, #80);
// - the real widget loading on every form page, under our policy and with no
//   other outside origin, is checked by `watchRealTurnstile` in
//   no-third-party.spec.ts, apply.spec.ts, accessibility.spec.ts and
//   form-navigation.spec.ts;
// - getting a real token and sending it is a manual go-live check on staging;
// - "the spam check couldn't load" still aborts the real URL.
//
// The stand-in is served at the real script URL, so the browser applies our
// content security policy to it as it would to the real thing. Nothing in
// app/ or server/ knows about it.
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`

/** Cloudflare's dummy token; made up, and accepted by nothing on its own. */
export const FAKE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

/** The options the page passed to each render, without the callbacks. */
export interface StandInRender {
  sitekey: string
  action: string
  execution: string
  appearance: string
}

// Runs in the page. It records each render's options and answers each
// execute with the fake token, a moment later, as the real widget would.
const STAND_IN = `(() => {
  const widgets = new Map()
  const renders = []
  window.__turnstileStandIn = { renders }
  window.turnstile = {
    render(container, options) {
      const id = 'stand-in-' + (widgets.size + 1)
      widgets.set(id, options)
      renders.push({
        sitekey: options.sitekey,
        action: options.action,
        execution: options.execution,
        appearance: options.appearance,
      })
      return id
    },
    execute(id) {
      const options = widgets.get(id)
      if (options) setTimeout(() => options.callback(${JSON.stringify(FAKE_TOKEN)}), 0)
    },
    reset() {},
    remove(id) {
      widgets.delete(id)
    },
  }
})()`

/**
 * Serves the stand-in in place of Turnstile's script. Call it before the page
 * loads. A route added later in a test (such as one aborting Turnstile)
 * takes over from it.
 */
export async function useTurnstileStandIn(page: Page) {
  let hits = 0
  const real: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith(`${TURNSTILE_ORIGIN}/`) && url !== SCRIPT_URL) real.push(url)
  })
  await page.route(SCRIPT_URL, (route) => {
    hits += 1
    return route.fulfill({ contentType: 'text/javascript', body: STAND_IN })
  })
  return {
    /** How many times the page asked for the script and got the stand-in. */
    hits: () => hits,
    /**
     * Requests to Turnstile's origin other than the script the stand-in
     * answers. Any at all means the real widget loaded, for example because
     * the script URL changed (Kit, #150).
     */
    realRequests: () => real,
    renders: () =>
      page.evaluate(
        () =>
          (window as { __turnstileStandIn?: { renders: StandInRender[] } }).__turnstileStandIn
            ?.renders ?? [],
      ),
  }
}

/**
 * Records requests to our own origin from now on. `settled()` waits until
 * none has been in flight for half a second. Unlike `networkidle`, it ignores
 * Turnstile's requests, which can stay open (see above).
 */
export function watchOwnRequests(page: Page, ownOrigin: string) {
  const inFlight = new Set<Request>()
  let changedAt = Date.now()
  const isOwn = (url: string) => new URL(url).origin === ownOrigin
  page.on('request', (request) => {
    if (!isOwn(request.url())) return
    inFlight.add(request)
    changedAt = Date.now()
  })
  const done = (request: Request) => {
    if (inFlight.delete(request)) changedAt = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  // Requests the old document still had open when a new one replaced it
  // (the apply flow loads its chunks, then reloads as a form page). The
  // browser drops them, but Playwright never reports them finished or
  // failed, so they are let go once the new document has arrived.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    for (const request of inFlight) if (!request.isNavigationRequest()) done(request)
  })

  // A script asked for twice can be answered from the browser's memory cache
  // without Playwright ever reporting it finished. The page's own timing
  // entries show the browser has it, so those count as done too.
  const loadedInPage = async () => {
    try {
      return new Set(
        await page.evaluate(() =>
          (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            // Only scripts and styles: a repeated API call to the same URL
            // must still be waited for (Theo, #150).
            .filter((entry) => entry.initiatorType === 'script' || entry.initiatorType === 'link')
            .map((entry) => entry.name),
        ),
      )
    } catch {
      // The page is between documents; try again on the next poll.
      return new Set<string>()
    }
  }

  return {
    settled: () =>
      expect
        .poll(
          async () => {
            const loaded = await loadedInPage()
            for (const request of inFlight) if (loaded.has(request.url())) done(request)
            return inFlight.size === 0 && Date.now() - changedAt >= 500
          },
          {
            message: 'our own requests should finish',
            intervals: [100],
          },
        )
        .toBe(true),
  }
}

/**
 * Starts watching for the real Turnstile script. Call before the step that
 * loads it, then await `loaded()`: the script must load and the widget's
 * frame from Turnstile's origin must appear. It doesn't wait for a token,
 * because that is the part that can hang.
 */
/** How long the real script may take before we call Cloudflare unreachable. */
const REAL_SCRIPT_TIMEOUT_MS = 20_000

export function watchRealTurnstile(page: Page) {
  // Turnstile redirects the script URL to a versioned one, so this waits for
  // the end of that chain.
  // Its own timeout and message, so a hang reads as Cloudflare being
  // unreachable from the test machine rather than a fault in our code. It
  // still fails: these checks exist to prove the real widget loads.
  const script = page
    .waitForResponse(
      (response) => {
        let first = response.request()
        while (first.redirectedFrom()) first = first.redirectedFrom()!
        const redirect = response.status() >= 300 && response.status() < 400
        return first.url() === SCRIPT_URL && !redirect
      },
      { timeout: REAL_SCRIPT_TIMEOUT_MS },
    )
    .catch(() => {
      throw new Error(
        `Turnstile's script didn't answer within ${REAL_SCRIPT_TIMEOUT_MS / 1000}s: check that ${TURNSTILE_ORIGIN} can be reached from the test machine`,
      )
    })
  // Nothing awaits it if a test fails before calling loaded(), so this keeps
  // that rejection from being reported as unhandled (Theo, #150).
  script.catch(() => {})
  return {
    loaded: async () => {
      const response = await script
      expect(response.ok(), 'Turnstile script should load').toBe(true)
      await expect
        .poll(() => page.frames().some((frame) => frame.url().startsWith(`${TURNSTILE_ORIGIN}/`)), {
          message: "Turnstile's frame should appear",
        })
        .toBe(true)
    },
  }
}
