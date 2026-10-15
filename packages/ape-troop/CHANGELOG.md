# @openape/ape-troop

## 1.0.0

### Major Changes

- 139c15e: Retire OpenClaw integration. Nest and agent provisioning support only the bridge runtime; legacy unsupported registry entries remain stored but cannot start. Remove the OpenClaw setup and grant-gate packages and their distribution tooling. Imported skill requirements now use metadata.openape; metadata.openclaw is rejected with migration guidance. Generic DDISA, grant authorization and CLI extensions remain available.

## 0.2.3

### Patch Changes

- Updated dependencies [8baa724]
  - @openape/cli-auth@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies
  - @openape/cli-auth@0.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [24e53aa]
  - @openape/cli-auth@0.5.3

## 0.2.0

### Minor Changes

- 3c10ba7: `agents list` groups agents by company and shows the reporting hierarchy
  (Operator/CEO → Teamlead → Specialists) instead of one flat list. Agents
  without a company are listed in a trailing "Ohne Firma" group. Reads the new
  `orgId`/`orgName`/`orgRole`/`reportsToEmail` fields from `/api/agents`; against
  an older troop that omits them every agent simply lands in that group.

## 0.1.2

### Patch Changes

- Updated dependencies [12d7dd6]
  - @openape/cli-auth@0.5.2

## 0.1.1

### Patch Changes

- Updated dependencies [2ea39ac]
  - @openape/cli-auth@0.5.0
