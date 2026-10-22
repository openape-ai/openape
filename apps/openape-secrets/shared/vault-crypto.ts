// The vault cryptography lives in @openape/secrets-crypto so the web app and
// the ape-secrets CLI share one implementation; this keeps `#shared` imports stable.
export * from '@openape/secrets-crypto'
