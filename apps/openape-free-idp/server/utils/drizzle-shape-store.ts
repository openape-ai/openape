import type { ServerShape, ServerShapeOperation, ShapeChange, ShapeCliVersions, ShapeStore, ShapeTier } from '@openape/grants'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { domainShapes, ownerShapes, shapeChanges, shapes } from '../database/schema'

type Db = ReturnType<typeof useDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Drizzle-backed ShapeStore. Wraps CRUD over the `shapes` table for the
 * openape-free-idp deployment. Tests use the in-memory variant from
 * `@openape/grants` (`createInMemoryShapeStore`).
 */
export function createDrizzleShapeStore(): ShapeStore {
  const db = useDb()

  return {
    async listShapes() {
      const rows = await db.select().from(shapes).orderBy(asc(shapes.cliId))
      return rows.map(rowToShape)
    },

    async getShape(cliId) {
      const row = await db.select().from(shapes).where(eq(shapes.cliId, cliId)).get()
      return row ? rowToShape(row) : null
    },

    async saveShape(shape) {
      await upsertShape(db, shape)
    },

    async deleteShape(cliId) {
      await db.delete(shapes).where(eq(shapes.cliId, cliId))
    },

    async listOwnerShapes(owner) {
      const rows = await db.select().from(ownerShapes).where(eq(ownerShapes.owner, owner)).orderBy(asc(ownerShapes.cliId))
      return rows.map(row => ({
        cli_id: row.cliId,
        executable: row.executable,
        description: '',
        operations: row.operations as ServerShapeOperation[],
        source: 'custom' as const,
        owner: row.owner,
        digest: row.digest,
        toml: row.toml,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
    },

    async saveOwnerShape(owner, shape) {
      await upsertOwnerShape(db, owner, shape)
    },

    async deleteOwnerShape(owner, cliId) {
      const removed = await db.delete(ownerShapes).where(and(eq(ownerShapes.owner, owner), eq(ownerShapes.cliId, cliId))).returning({ cliId: ownerShapes.cliId })
      return removed.length > 0
    },

    async listDomainShapes(domain) {
      const rows = await db.select().from(domainShapes).where(eq(domainShapes.domain, domain)).orderBy(asc(domainShapes.cliId))
      return rows.map(row => ({
        cli_id: row.cliId,
        executable: row.executable,
        description: row.description,
        operations: row.operations as ServerShapeOperation[],
        source: 'custom' as const,
        domain: row.domain,
        published_by: row.publishedBy,
        digest: row.digest,
        toml: row.toml,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
    },

    async saveDomainShape(domain, shape) {
      await upsertDomainShape(db, domain, shape)
    },

    async deleteDomainShape(domain, cliId) {
      const removed = await db.delete(domainShapes).where(and(eq(domainShapes.domain, domain), eq(domainShapes.cliId, cliId))).returning({ cliId: domainShapes.cliId })
      return removed.length > 0
    },

    async applyShapeChanges(batch) {
      await db.transaction(async (tx) => {
        const { scope, scope_key: key } = batch
        if (batch.remove.length) {
          if (scope === 'instance') await tx.delete(shapes).where(inArray(shapes.cliId, batch.remove))
          else if (scope === 'domain') await tx.delete(domainShapes).where(and(eq(domainShapes.domain, key), inArray(domainShapes.cliId, batch.remove)))
          else await tx.delete(ownerShapes).where(and(eq(ownerShapes.owner, key), inArray(ownerShapes.cliId, batch.remove)))
        }
        for (const shape of batch.save) {
          if (scope === 'instance') await upsertShape(tx, shape)
          else if (scope === 'domain') await upsertDomainShape(tx, key, shape)
          else await upsertOwnerShape(tx, key, shape)
        }
        if (batch.changes.length) await tx.insert(shapeChanges).values(batch.changes.map(change => ({ scope: change.scope, scopeKey: change.scope_key, action: change.action, cliId: change.cli_id, previousDigest: change.previous_digest, digest: change.digest, previousToml: change.previous_toml, toml: change.toml, source: change.source, actor: change.actor, createdAt: change.created_at })))
      })
    },

    async listShapeChanges(scope, scopeKey, limit) {
      const rows = await db.select().from(shapeChanges).where(and(eq(shapeChanges.scope, scope), eq(shapeChanges.scopeKey, scopeKey))).orderBy(desc(shapeChanges.id)).limit(limit)
      return rows.map((row): ShapeChange => ({ scope: row.scope as ShapeTier, scope_key: row.scopeKey, action: row.action as ShapeChange['action'], cli_id: row.cliId, previous_digest: row.previousDigest, digest: row.digest, previous_toml: row.previousToml, toml: row.toml, source: (row.source as ShapeChange['source']) ?? null, actor: row.actor, created_at: row.createdAt }))
    },
  }
}

async function upsertShape(db: Db | Tx, shape: ServerShape): Promise<void> {
  const values = {
    cliId: shape.cli_id,
    executable: shape.executable,
    description: shape.description,
    operations: shape.operations,
    source: shape.source,
    digest: shape.digest,
    versions: shape.versions ?? null,
    testedDigests: shape.tested_digests ?? null,
    virtual: shape.virtual ?? null,
    createdAt: shape.createdAt,
    updatedAt: shape.updatedAt,
  }
  await db.insert(shapes).values(values).onConflictDoUpdate({
    target: shapes.cliId,
    set: {
      executable: values.executable,
      description: values.description,
      operations: values.operations,
      source: values.source,
      digest: values.digest,
      versions: values.versions,
      testedDigests: values.testedDigests,
      virtual: values.virtual,
      updatedAt: values.updatedAt,
    },
  })
}

async function upsertOwnerShape(db: Db | Tx, owner: string, shape: ServerShape): Promise<void> {
  const values = { owner, cliId: shape.cli_id, executable: shape.executable, operations: shape.operations, digest: shape.digest, toml: shape.toml ?? '', createdAt: shape.createdAt, updatedAt: shape.updatedAt }
  await db.insert(ownerShapes).values(values).onConflictDoUpdate({
    target: [ownerShapes.owner, ownerShapes.cliId],
    set: { executable: values.executable, operations: values.operations, digest: values.digest, toml: values.toml, updatedAt: values.updatedAt },
  })
}

async function upsertDomainShape(db: Db | Tx, domain: string, shape: ServerShape): Promise<void> {
  const values = { domain, cliId: shape.cli_id, executable: shape.executable, description: shape.description, operations: shape.operations, digest: shape.digest, toml: shape.toml ?? '', publishedBy: shape.published_by ?? '', createdAt: shape.createdAt, updatedAt: shape.updatedAt }
  await db.insert(domainShapes).values(values).onConflictDoUpdate({
    target: [domainShapes.domain, domainShapes.cliId],
    set: { executable: values.executable, description: values.description, operations: values.operations, digest: values.digest, toml: values.toml, publishedBy: values.publishedBy, updatedAt: values.updatedAt },
  })
}

function rowToShape(row: typeof shapes.$inferSelect): ServerShape {
  return {
    cli_id: row.cliId,
    executable: row.executable,
    description: row.description,
    operations: row.operations as ServerShapeOperation[],
    source: row.source as 'builtin' | 'custom',
    digest: row.digest,
    ...(row.versions ? { versions: row.versions as ShapeCliVersions } : {}),
    ...(row.testedDigests ? { tested_digests: row.testedDigests as string[] } : {}),
    ...(row.virtual ? { virtual: true } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
