
## PRF vault (v2)

For passkey-approved, reusable stored secrets use `ape-secrets vault request`,
`vault status`, and `vault deliver`. Unlike legacy `fetch`, `deliver` never prints
plaintext and requires a new `--out` file or a quiet `--exec` JSON argv array.
The browser must first bind the consumer/collector with a passkey. See the
[rollout, threat boundaries and CLI examples](../../apps/openape-secrets/docs/prf-vault.md).

Recipient private keys follow the CLI authentication profile: normally
`~/.config/apes/secrets/`, or `$OPENAPE_CLI_AUTH_HOME/secrets/` when that profile
override is set. Use a separate profile for each isolated agent or local pilot.
