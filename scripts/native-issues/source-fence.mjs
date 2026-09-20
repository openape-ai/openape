export function sourceFence(repositoryId) {
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) throw new Error('A verified positive source repository ID is required')
  const issues = `SELECT id FROM issue WHERE repo_id=${repositoryId} AND is_pull=0`
  const child = alias => `${alias}.issue_id IN (${issues})`
  const predicates = {
    issue: alias => `${alias}.repo_id=${repositoryId} AND ${alias}.is_pull=0`,
    comment: child,
    issue_assignees: child,
    issue_label: child,
    issue_content_history: child,
    project_issue: child,
    reaction: child,
    stopwatch: child,
    tracked_time: child,
    issue_dependency: alias => `(${child(alias)}) OR ${alias}.dependency_id IN (${issues})`,
    label: alias => `${alias}.repo_id=${repositoryId}`,
    attachment: alias => `(${child(alias)}) OR ${alias}.comment_id IN (SELECT id FROM comment WHERE issue_id IN (${issues}))`,
  }
  const names = []; const statements = []
  const immutableAttachmentColumns = ['id', 'uuid', 'uploader_id', 'repo_id', 'issue_id', 'release_id', 'comment_id', 'name', 'size', 'created_unix', 'external_url']
  function trigger(name, operation, table, condition) {
    const fullName = `openape_issue_archive_${repositoryId}_${name}`
    names.push(fullName)
    statements.push(`CREATE TRIGGER ${fullName} BEFORE ${operation} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'OPENAPE_ISSUE_ARCHIVE_READ_ONLY'); END;`)
  }
  for (const [table, predicate] of Object.entries(predicates)) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      let condition = operation === 'UPDATE' ? `(${predicate('OLD')}) OR (${predicate('NEW')})` : predicate(operation === 'DELETE' ? 'OLD' : 'NEW')
      if (table === 'attachment' && operation === 'UPDATE') condition = `(${condition}) AND (${immutableAttachmentColumns.map(column => `OLD.${column} IS NOT NEW.${column}`).join(' OR ')})`
      trigger(`${table}_${operation.toLowerCase()}`, operation, table, condition)
    }
  }
  trigger('repository_delete', 'DELETE', 'repository', `OLD.id=${repositoryId}`)
  trigger('repository_identity', 'UPDATE OF id, owner_id, owner_name, name, lower_name, is_private', 'repository', `OLD.id=${repositoryId} OR NEW.id=${repositoryId}`)
  trigger('actor_delete', 'DELETE', 'user', `OLD.id IN (SELECT poster_id FROM issue WHERE id IN (${issues}) UNION SELECT poster_id FROM comment WHERE issue_id IN (${issues}) UNION SELECT owner_id FROM repository WHERE id=${repositoryId})`)
  return {
    install: `BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;\n`,
    remove: `BEGIN IMMEDIATE;\n${names.map(name => `DROP TRIGGER ${name};`).join('\n')}\nCOMMIT;\n`,
    names,
  }
}
