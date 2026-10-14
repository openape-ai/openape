/** SQLite's answer to adding a column that exists; the error may sit in the driver's cause. */
export function isDuplicateColumn(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : String(error)
  return /duplicate column name/i.test(text)
}
