// Deterministic server clock for the guides capture.
//
// Every app stamps created_at / updated_at with JS `Date.now()` (there is no
// SQLite CURRENT_TIMESTAMP anywhere), so freezing the JS clock to a fixed
// instant makes those timestamps identical across `pnpm guides` runs — the ~12
// screenshots that used to churn on a plan's "Updated …" / a passkey's "Added …"
// now render the same date every time.
//
// A JS-level Date override on purpose, not libfaketime: an LD_PRELOAD clock
// would also freeze the C-level `time()` that OpenSSL uses to check certificate
// validity, so the app's server-side SP→IdP TLS calls would reject the local
// Caddy certs (issued at real-now) as not-yet-valid. Overriding `Date` in JS
// leaves the C clock — and thus TLS — on real time.
//
// No-op unless OPENAPE_FAKE_NOW (epoch millis) is set, so a bare `docker compose
// up` and the agent-lifecycle profile keep the real clock. Only compose/demo/run.sh
// exports it. The value matches installDeterminism's FIXED in story-kit.mjs so the
// browser clock and the server clock agree (2026-06-01T09:00:00Z).

const fixed = Number(process.env.OPENAPE_FAKE_NOW)

if (Number.isFinite(fixed) && fixed > 0) {
  const RealDate = Date
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0)
        super(fixed)
      else
        super(...args)
    }

    static now() {
      return fixed
    }
  }
  globalThis.Date = FrozenDate
}
