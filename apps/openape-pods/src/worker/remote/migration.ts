import type { DatabaseSync } from 'node:sqlite'

export function migrateRemote(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE remote_program_catalog(id TEXT PRIMARY KEY,owner TEXT NOT NULL,definition TEXT NOT NULL,hash TEXT NOT NULL,revoked INTEGER NOT NULL);
    CREATE TABLE remote_program_reviews(id TEXT PRIMARY KEY,pod_id TEXT NOT NULL REFERENCES pods(id),body TEXT NOT NULL);
    CREATE TABLE remote_registration(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,enabled INTEGER NOT NULL);
    CREATE TABLE remote_pods(pod_id TEXT PRIMARY KEY REFERENCES pods(id),owner TEXT NOT NULL,runtime_id TEXT NOT NULL,generation TEXT NOT NULL,phase TEXT NOT NULL,identity TEXT,error TEXT);
    CREATE TABLE remote_conversations(conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id),owner TEXT NOT NULL);
    CREATE TABLE remote_devices(id TEXT PRIMARY KEY,owner TEXT NOT NULL,keys TEXT NOT NULL,epoch INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE remote_inbox(id TEXT PRIMARY KEY,hash TEXT NOT NULL,device_id TEXT NOT NULL,route TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,result TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE remote_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,operation_id TEXT NOT NULL,device_id TEXT NOT NULL,route TEXT NOT NULL,body TEXT NOT NULL,envelope TEXT,acknowledged INTEGER NOT NULL DEFAULT 0);
  `)
}
