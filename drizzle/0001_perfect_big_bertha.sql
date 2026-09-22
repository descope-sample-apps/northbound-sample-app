CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`logo_path` text,
	`owner` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `authorization_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`client_id` text NOT NULL,
	`customer_id` integer NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`authorization_details` text,
	`redirect_uri` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `authorization_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `authorization_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`customer_id` integer,
	`redirect_uri` text NOT NULL,
	`scope` text NOT NULL,
	`state` text,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text NOT NULL,
	`authorization_details` text,
	`resource` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`approved_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_secret_hash` text,
	`agent_id` text NOT NULL,
	`client_name` text NOT NULL,
	`logo_uri` text,
	`redirect_uris` text NOT NULL,
	`grant_types` text NOT NULL,
	`token_endpoint_auth_method` text NOT NULL,
	`scope` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`jti` text NOT NULL,
	`client_id` text NOT NULL,
	`agent_id` text,
	`customer_id` integer,
	`scope` text NOT NULL,
	`authorization_details` text,
	`parent_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_token_hash_unique` ON `tokens` (`token_hash`);