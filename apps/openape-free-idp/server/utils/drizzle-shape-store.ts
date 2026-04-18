import type { ServerShape, ServerShapeOperation, ShapeStore } from '@openape/grants'
import { asc, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { shapes } from '../database/schema'

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
      const values = {
        cliId: shape.cli_id,
        executable: shape.executable,
        description: shape.description,
        operations: shape.operations,
        source: shape.source,
        digest: shape.digest,
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
          updatedAt: values.updatedAt,
        },
      })
    },

    async deleteShape(cliId) {
      await db.delete(shapes).where(eq(shapes.cliId, cliId))
    },
  }
}

function rowToShape(row: typeof shapes.$inferSelect): ServerShape {
  return {
    cli_id: row.cliId,
    executable: row.executable,
    description: row.description,
    operations: row.operations as ServerShapeOperation[],
    source: row.source as 'builtin' | 'custom',
    digest: row.digest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
