export const prototypeSchema = `
CREATE TABLE IF NOT EXISTS prototype_networks(id TEXT PRIMARY KEY, restore_nonce TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused')),activation_epoch INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS prototype_members(network_id TEXT NOT NULL REFERENCES prototype_networks(id),pod_id TEXT PRIMARY KEY REFERENCES pods(id));
CREATE TABLE IF NOT EXISTS prototype_subscriptions(id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES prototype_networks(id),pod_id TEXT NOT NULL REFERENCES pods(id),channel TEXT NOT NULL,UNIQUE(network_id,pod_id,channel));
CREATE TABLE IF NOT EXISTS prototype_identities(network_id TEXT NOT NULL,namespace TEXT NOT NULL,identity_hash TEXT NOT NULL,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,accepted_at INTEGER NOT NULL,PRIMARY KEY(network_id,namespace,identity_hash));
CREATE TABLE IF NOT EXISTS prototype_events(id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES prototype_networks(id),channel TEXT NOT NULL,item_key TEXT NOT NULL,payload TEXT NOT NULL,accepted_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prototype_invocations(id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES prototype_networks(id),pod_id TEXT NOT NULL REFERENCES pods(id),boot TEXT NOT NULL,restore_nonce TEXT NOT NULL,token TEXT NOT NULL,activation_epoch INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('running','stopping','completed','interrupted','blocked')));
CREATE TABLE IF NOT EXISTS prototype_leases(pod_id TEXT PRIMARY KEY REFERENCES pods(id),invocation_id TEXT NOT NULL UNIQUE REFERENCES prototype_invocations(id));
CREATE TABLE IF NOT EXISTS prototype_deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES prototype_events(id),subscription_id TEXT NOT NULL REFERENCES prototype_subscriptions(id),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','done','blocked','unknown')),invocation_id TEXT REFERENCES prototype_invocations(id),generation INTEGER NOT NULL DEFAULT 0,UNIQUE(event_id,subscription_id));
CREATE INDEX IF NOT EXISTS prototype_ready ON prototype_deliveries(subscription_id,state,id);
CREATE TABLE IF NOT EXISTS prototype_checkpoints(pod_id TEXT PRIMARY KEY REFERENCES pods(id),revision INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prototype_records(network_id TEXT NOT NULL REFERENCES prototype_networks(id),item_key TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(network_id,item_key));
CREATE TABLE IF NOT EXISTS prototype_record_revisions(network_id TEXT NOT NULL,item_key TEXT NOT NULL,revision INTEGER NOT NULL,invocation_id TEXT NOT NULL REFERENCES prototype_invocations(id),body TEXT NOT NULL,PRIMARY KEY(network_id,item_key,revision));
CREATE TABLE IF NOT EXISTS prototype_effect_attempts(logical_key TEXT NOT NULL,attempt INTEGER NOT NULL,invocation_id TEXT NOT NULL REFERENCES prototype_invocations(id),state TEXT NOT NULL CHECK(state IN ('intent','unknown','completed','not_applied')),input_digest TEXT NOT NULL,PRIMARY KEY(logical_key,attempt));
CREATE UNIQUE INDEX IF NOT EXISTS prototype_one_effect_intent ON prototype_effect_attempts(logical_key) WHERE state='intent';
CREATE TABLE IF NOT EXISTS prototype_effect_receipts(logical_key TEXT NOT NULL,attempt INTEGER NOT NULL,sequence INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(logical_key,attempt,sequence),FOREIGN KEY(logical_key,attempt) REFERENCES prototype_effect_attempts(logical_key,attempt));
CREATE TABLE IF NOT EXISTS prototype_queue_counts(network_id TEXT NOT NULL,state TEXT NOT NULL,count INTEGER NOT NULL CHECK(count>=0),PRIMARY KEY(network_id,state));
CREATE TRIGGER IF NOT EXISTS prototype_delivery_insert AFTER INSERT ON prototype_deliveries BEGIN
  INSERT INTO prototype_queue_counts VALUES((SELECT network_id FROM prototype_subscriptions WHERE id=NEW.subscription_id),NEW.state,1) ON CONFLICT(network_id,state) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER IF NOT EXISTS prototype_delivery_transition AFTER UPDATE OF state ON prototype_deliveries WHEN OLD.state<>NEW.state BEGIN
  UPDATE prototype_queue_counts SET count=count-1 WHERE network_id=(SELECT network_id FROM prototype_subscriptions WHERE id=OLD.subscription_id) AND state=OLD.state;
  INSERT INTO prototype_queue_counts VALUES((SELECT network_id FROM prototype_subscriptions WHERE id=NEW.subscription_id),NEW.state,1) ON CONFLICT(network_id,state) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER IF NOT EXISTS prototype_delivery_delete AFTER DELETE ON prototype_deliveries BEGIN
  UPDATE prototype_queue_counts SET count=count-1 WHERE network_id=(SELECT network_id FROM prototype_subscriptions WHERE id=OLD.subscription_id) AND state=OLD.state;
END;
`
