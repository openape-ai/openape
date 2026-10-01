# Schema-27 migration inventory

Read-only census of the existing stopped October 1 release rollback profile.
No current owner runtime, schedule, grant or provider was mutated. The existing
`createBackup` API successfully produced an isolated private archive: schema 27,
89 tables, 121 files, 20,703,926 bytes. Private receipt and row fingerprints stay
outside Git and Reports under `~/Library/Application Support/OpenApe Pods
Implementation/issue-1417/m0/inventory.json`.

38 Pods, seven schedules, five finite/bounded compositions, 42 graph items,
47 per-consumer deliveries, no graph gate batches and 70 effect receipts are
present. Counts describe this stopped backup, not the current live runtime.
Portable backups exclude credentials by contract; preserve the original paired
profile/Keychain and inventory encrypted files separately for M13.

## Every existing table destination

Every table below remains in place with its IDs and historical semantics.
New tables are additive; none of these rows is automatically reinterpreted as
an active persistent network. Existing workflow reservations and recovery domains
remain evidence requiring the existing recovery classifier, never lease transfer.

| Schema-27 table | Rows | Migration destination |
| --- | ---: | --- |
| `accepted_events` | 10808 | Keep legacy scheduling/input states; no automatic trigger transfer. |
| `access_proposals` | 7 | Keep existing instance/workspace state and existing backup/restore policy. |
| `assignments` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `chat_active` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `chat_contexts` | 149 | Keep existing instance/workspace state and existing backup/restore policy. |
| `chat_conversations` | 49 | Keep existing instance/workspace state and existing backup/restore policy. |
| `chat_members` | 86 | Keep existing instance/workspace state and existing backup/restore policy. |
| `chat_message_context` | 202 | Keep existing instance/workspace state and existing backup/restore policy. |
| `checkpoints` | 38 | Keep existing instance/workspace state and existing backup/restore policy. |
| `claims` | 33 | Keep existing instance/workspace state and existing backup/restore policy. |
| `connections` | 5 | Keep existing instance/workspace state and existing backup/restore policy. |
| `control_changes` | 2 | Keep existing instance/workspace state and existing backup/restore policy. |
| `control_runs` | 32 | Keep existing instance/workspace state and existing backup/restore policy. |
| `data_settings` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `deletion_jobs` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `dependency_domains` | 0 | Keep legacy authority/recovery; new network epoch is separate. |
| `dependency_sets` | 0 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `draft_packages` | 55 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `effect_ledger` | 70 | Keep receipts/reconciliation; never automatically resend or clear. |
| `execution_domains` | 455 | Keep legacy authority/recovery; new network epoch is separate. |
| `graph_deliveries` | 47 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `graph_gate_batches` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `graph_item_events` | 79 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `graph_items` | 42 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `mail_contexts` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `mail_extractions` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `mail_inventory` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `mail_items` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `mail_receipts` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_actions` | 1157 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_contexts` | 5 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_creations` | 3 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_domains` | 1 | Keep legacy authority/recovery; new network epoch is separate. |
| `master_inputs` | 11 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_message_scopes` | 202 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_messages` | 202 | Keep existing instance/workspace state and existing backup/restore policy. |
| `master_session` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `onboarding` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_chat_origins` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_descriptions` | 15 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_groups` | 3 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_memberships` | 32 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_organization` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pod_variables` | 26 | Keep existing instance/workspace state and existing backup/restore policy. |
| `pods` | 38 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `program_leases` | 0 | Keep legacy authority/recovery; new network epoch is separate. |
| `recovery_reviews` | 7 | Keep receipts/reconciliation; never automatically resend or clear. |
| `reference_observations` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `remote_conversations` | 2 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_devices` | 1 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_inbox` | 80 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_outbox` | 116 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_pods` | 38 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_program_catalog` | 0 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_program_reviews` | 0 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `remote_registration` | 1 | Keep owner/runtime identity and registration history; no relay execution authority. |
| `resource_epochs` | 32 | Keep existing instance/workspace state and existing backup/restore policy. |
| `resources` | 70 | Keep existing instance/workspace state and existing backup/restore policy. |
| `run_deletion_jobs` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `run_events` | 4361 | Keep existing instance/workspace state and existing backup/restore policy. |
| `run_inputs` | 346 | Keep legacy scheduling/input states; no automatic trigger transfer. |
| `run_leases` | 0 | Keep legacy authority/recovery; new network epoch is separate. |
| `runs` | 346 | Keep existing instance/workspace state and existing backup/restore policy. |
| `schedules` | 7 | Keep legacy scheduling/input states; no automatic trigger transfer. |
| `script_credential_approvals` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `script_dependencies` | 0 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `script_drafts` | 55 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `scripts` | 69 | Keep instance/code/history; add unpublished pinned definition binding in M8. |
| `settings` | 1 | Keep existing instance/workspace state and existing backup/restore policy. |
| `snapshot_sets` | 11095 | Keep existing instance/workspace state and existing backup/restore policy. |
| `source_derivations` | 0 | Keep existing instance/workspace state and existing backup/restore policy. |
| `sources` | 25 | Keep existing instance/workspace state and existing backup/restore policy. |
| `summary_domains` | 1 | Keep legacy authority/recovery; new network epoch is separate. |
| `validations` | 78 | Keep existing instance/workspace state and existing backup/restore policy. |
| `workflow_attempts` | 88 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_channels` | 37 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_gates` | 4 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_audit` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_batches` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_participants` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_pending` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_processed` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_mail_scopes` | 0 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_members` | 33 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_nodes` | 105 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_reservations` | 4 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_runs` | 22 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflow_values` | 22 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |
| `workflows` | 5 | Keep legacy finite/bounded workflow state; explicit M11 ancestry/import only. |

## Additive relational contract

All new UUIDs are local runtime-generated. Owner keys use the existing serialized
Owner contract; group IDs reference `pod_groups`, instance IDs reference `pods`,
and invocation IDs reference `runs`. Immutable version rows cannot be edited.
Foreign keys restrict deletion of live authority/evidence. Do not cascade-delete
unresolved business/delivery/gate state. Choose migration numbers after M1 against
refreshed main; M0 does not reserve a schema number.

| New logical table | Key and foreign-key/uniqueness contract |
| --- | --- |
| `pod_definitions` | id; owner; no identity or credential binding. |
| `pod_definition_versions` | (definition_id, version); immutable content/lock/contract hashes; FK definition. |
| `instance_definition_bindings` | pod_id; FK Pod and definition/version; pinned binding revision. |
| `networks` | id; owner/group FK; state; epoch; ancestry FK workflows where converted. |
| `network_revisions` | (network_id, revision); FK network; immutable contract/configuration. |
| `network_members` | (network_id, pod_id); UNIQUE(pod_id); FK network/Pod; pinned revision. |
| `network_subscriptions` | id; FK network revision/member; UNIQUE(network, revision, member, channel). |
| `network_events` | event_id; FK network revision; source/case/schema envelope; immutable payload hash. |
| `network_deliveries` | id; FK event/subscription/run; UNIQUE(event_id, subscription_id); token/epoch/state. |
| `source_deduplication` | UNIQUE(owner, network, source, source_item, source_version, channel, schema_version); hash/receipt retained independently of pruned event bytes. |
| `network_joins` | UNIQUE(network, join_id, case_id, case_revision); pinned declaration, deadline, outcome; input channel uniqueness. |
| `workflow_call_requests` | request_id; FK caller revision and workflow revision/execution; immutable request hash and one terminal result. |
| `workflow_revisions` | (workflow_id, revision); FK workflow; new named ports/completion policies without rewriting legacy runs. |
| `data_collections` | id; UNIQUE(owner, group, name); immutable schema versions and declared indexes. |
| `data_permissions` | UNIQUE(network, pod, collection, operation); scoped revision; FKs network/Pod/collection. |
| `data_records` | (collection_id, key); FK collection; current revision/tombstone. |
| `data_record_revisions` | (collection_id, key, revision); FK record and author run/version; immutable provenance. |
| `artifacts` | id; owner/group; immutable hash/size/type/storage reference; no public host path. |
| `artifact_references` | UNIQUE(artifact_id, reference_kind, reference_id); FK artifact; retained live reference. |
| `network_gate_tasks` | id; FK network revision/consumer Pod; immutable manifest/digest; durable consumed/unknown evidence. |
| `network_trace_events` | id; FK network; case/run/event references and stable detail cursor; bounded completed history. |

Claim-ready indexes start with `(subscription_id, state, ready_at, accepted_at, id)`,
case serialization with `(network_id, pod_id, case_id, state)`, and marker retention
with `(network_id, retain_until)`. Collection queries use only declared indexes.
M1 compares query plans/latency with the frozen workload.

## Evidence limits and dependencies

The existing backup validates SQLite integrity and referenced code/source/snapshot
bytes. Its snapshot export is driven by database metadata and excludes unused files
and credentials. Restore currently rewrites snapshot paths and awaits filesystem I/O
inside its restore transaction; new normal settlement must not copy that pattern.
No current owner restore was run. M2 must extend authoritative restore coverage,
pause new networks and revoke new epochs while retaining deduplication/effect evidence.

Sharing has no delivered exporter/importer at baseline; the UI explicitly hides it.
M11 must deliver the approved file slice with fresh recipient identities and zero
transported credentials/grants/business records. Existing invitation/production mail
acceptance lifecycles stay separate.
