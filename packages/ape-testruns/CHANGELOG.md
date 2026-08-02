# @openape/ape-testruns

## 0.2.1

### Patch Changes

- Updated dependencies
  - @openape/cli-auth@0.5.4
  - @openape/proof-cli@0.1.3

## 0.2.0

### Minor Changes

- f42b8b9: `upload --series <key>`: stable, versioned proof links. Re-uploading with the
  same series key (same uploader) updates the SAME report link — the version
  increments and earlier versions stay viewable via `?v=<n>` — instead of
  minting a new link per upload. Without a series key nothing changes.

### Patch Changes

- Updated dependencies [24e53aa]
  - @openape/cli-auth@0.5.3
  - @openape/proof-cli@0.1.2
