export const networkRoutingSchema = `
CREATE TABLE network_choices(
  network_id TEXT NOT NULL,
  network_revision INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  option_key TEXT,
  result_event_id TEXT,
  decided_at INTEGER,
  PRIMARY KEY(network_id,event_id,gate_key),
  FOREIGN KEY(network_id,network_revision) REFERENCES network_revisions(network_id,revision),
  FOREIGN KEY(network_id,event_id) REFERENCES network_events(network_id,id),
  FOREIGN KEY(network_id,result_event_id) REFERENCES network_events(network_id,id),
  CHECK((option_key IS NULL AND result_event_id IS NULL AND decided_at IS NULL) OR
    (option_key IS NOT NULL AND result_event_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX network_choices_waiting ON network_choices(network_id,network_revision,decided_at);
`
export const networkRoutingTables = ['network_choices']
