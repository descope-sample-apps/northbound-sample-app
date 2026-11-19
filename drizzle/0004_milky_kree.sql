CREATE TABLE `agent_browser_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`poppy_session` text NOT NULL,
	`access_token` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `browser_join_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`join_secret_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`authorized_at` integer,
	`poppy_session` text,
	`access_token` text,
	`consumed_at` integer
);
