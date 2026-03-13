# Changelog

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @openape/auth@0.5.1

## 0.6.1

### Patch Changes

- Auto-rotate incompatible signing keys in IDP key store. Old ES256 keys from before the EdDSA migration are now deactivated automatically instead of crashing the token exchange.
