import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatContext } from '../../contracts/chats'

export function migrateChats(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE control_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT NOT NULL);
CREATE TABLE control_changes(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE INDEX control_changes_conversation ON control_changes(conversation_id);
CREATE TABLE chat_conversations(id TEXT PRIMARY KEY,scope TEXT NOT NULL UNIQUE,title TEXT NOT NULL,origin_pod TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE chat_contexts(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),revision INTEGER NOT NULL,body TEXT NOT NULL,retired_thread TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(conversation_id,revision));
CREATE TABLE chat_members(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),pod_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(conversation_id,pod_id));
CREATE TABLE chat_message_context(message_id TEXT PRIMARY KEY REFERENCES master_messages(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),revision INTEGER NOT NULL);
CREATE INDEX chat_message_history ON chat_message_context(conversation_id,revision);
CREATE TABLE chat_active(id INTEGER PRIMARY KEY CHECK(id=1),conversation_id TEXT REFERENCES chat_conversations(id));
INSERT INTO chat_active VALUES(1,NULL);
`)
  const scopes = db.prepare('SELECT scope FROM master_message_scopes UNION SELECT scope FROM master_contexts UNION SELECT CASE WHEN pod_id IS NULL THEN \'creation:\'||id ELSE pod_id END AS scope FROM master_creations').all()
  for (const row of scopes) {
    const scope = row.scope as string
    const pod = db.prepare('SELECT id,name FROM pods WHERE id=?').get(scope)
    const id = randomUUID(); const now = Date.now()
    const context: ChatContext = { podIds: pod ? [scope] : [], pods: pod ? [{ id: scope, name: pod.name as string }] : [], workflow: null }
    db.prepare('INSERT INTO chat_conversations VALUES(?,?,?,?,1,?,?)').run(id, scope, pod ? `${pod.name} conversation` : scope.startsWith('creation:') ? 'New Pod' : 'Workspace chat', pod ? scope : null, now, now)
    db.prepare('INSERT INTO chat_contexts VALUES(?,1,?,NULL,?)').run(id, JSON.stringify(context), now)
    if (pod) db.prepare('INSERT INTO chat_members VALUES(?,?,?)').run(id, scope, pod.name)
    db.prepare('INSERT INTO chat_message_context SELECT message_id,?,1 FROM master_message_scopes WHERE scope=?').run(id, scope)
    if (!scope) {
      db.prepare('UPDATE chat_contexts SET retired_thread=(SELECT thread_id FROM master_contexts WHERE scope=\'\') WHERE conversation_id=?').run(id)
      db.prepare('UPDATE master_contexts SET thread_id=NULL WHERE scope=\'\'').run()
      db.prepare('UPDATE master_session SET thread_id=NULL,active_turn=NULL,state=CASE WHEN state=\'running\' THEN \'interrupted\' ELSE state END WHERE id=1').run()
    }
  }
}
