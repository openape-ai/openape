CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`owner` text NOT NULL,
	`approver` text NOT NULL,
	`public_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agents_email` ON `agents` (`email`);--> statement-breakpoint
CREATE INDEX `idx_agents_owner` ON `agents` (`owner`);--> statement-breakpoint
CREATE INDEX `idx_agents_approver` ON `agents` (`approver`);--> statement-breakpoint
CREATE TABLE `codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`user_id` text NOT NULL,
	`nonce` text,
	`expires_at` integer NOT NULL,
	`extra_data` text
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`created_at` integer NOT NULL,
	`name` text
);
--> statement-breakpoint
CREATE INDEX `idx_credentials_user_email` ON `credentials` (`user_email`);--> statement-breakpoint
CREATE TABLE `grant_challenges` (
	`challenge` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`type` text,
	`requester` text NOT NULL,
	`target_host` text NOT NULL,
	`audience` text NOT NULL,
	`grant_type` text NOT NULL,
	`request` text NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`expires_at` integer,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_grants_status` ON `grants` (`status`);--> statement-breakpoint
CREATE INDEX `idx_grants_requester` ON `grants` (`requester`);--> statement-breakpoint
CREATE INDEX `idx_grants_created_at` ON `grants` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_grants_type` ON `grants` (`type`);--> statement-breakpoint
CREATE TABLE `jtis` (
	`jti` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_token_families` (
	`family_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`current_token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_families_user_id` ON `refresh_token_families` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_refresh_families_client_id` ON `refresh_token_families` (`client_id`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_family_id` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE TABLE `registration_urls` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`consumed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signing_keys` (
	`kid` text PRIMARY KEY NOT NULL,
	`private_key_jwk` text NOT NULL,
	`public_key_jwk` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`key_id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`public_key` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_keys_user_email` ON `ssh_keys` (`user_email`);--> statement-breakpoint
CREATE INDEX `idx_ssh_keys_public_key` ON `ssh_keys` (`public_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`token` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`user_email` text,
	`type` text NOT NULL,
	`expires_at` integer NOT NULL
);
