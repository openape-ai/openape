# @openape/ape-testruns

## 0.6.0

### Minor Changes

- Add versioned Test Run and Plan input schemas, generated types, semantic and evidence-integrity validation, reviewed responsive HTML layouts and reproducible rendering receipts. Keep legacy input readers while removing unsupported single-commit claims from legacy context.

## 0.5.0

### Minor Changes

- Add offline Plan and Test Run rendering, portable templates with embedded screenshots,
  and native Reports team commands. Deprecate legacy authoring commands while preserving
  compatibility until the producer inventory and observation gates are complete.

## 0.4.0

### Minor Changes

- 5268022: Add ape-reports for direct single-HTML publication, immutable versions, metadata discovery, explicit access and lifetime controls, and private recovery. Include isolated local preview, complete command help and standalone examples while preserving ape-testruns uploads. Plans edits now submit the version read, preventing stale source and status writes through the Reports compatibility adapter.

## 0.3.0

### Minor Changes

- 9c6676a: Publish private client-authored documents with extensible categories, immutable links, exact retry keys and sanitized previews. Existing test uploads remain compatible.

## 0.2.2

### Patch Changes

- Updated dependencies [dd0d9ac]
  - @openape/proof-cli@0.2.0

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
