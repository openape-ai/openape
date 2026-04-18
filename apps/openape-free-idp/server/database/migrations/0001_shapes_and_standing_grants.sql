-- Shapes registry table — server-side shape definitions (replaces
-- client-side ~/.openape/shapes/adapters/*.toml lookup in Phase 3).
CREATE TABLE `shapes` (
	`cli_id` text PRIMARY KEY NOT NULL,
	`executable` text NOT NULL,
	`description` text NOT NULL,
	`operations` text NOT NULL,
	`source` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_shapes_source` ON `shapes` (`source`);--> statement-breakpoint
CREATE INDEX `idx_shapes_executable` ON `shapes` (`executable`);--> statement-breakpoint

-- Grants: add decided_by_standing_grant column for audit-trail when an
-- incoming grant request auto-approves via a matching standing grant.
ALTER TABLE `grants` ADD `decided_by_standing_grant` text;
