PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`jti` text NOT NULL,
	`client_id` text,
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
INSERT INTO `__new_tokens`("id", "kind", "token_hash", "jti", "client_id", "agent_id", "customer_id", "scope", "authorization_details", "parent_id", "created_at", "expires_at", "revoked_at") SELECT "id", "kind", "token_hash", "jti", "client_id", "agent_id", "customer_id", "scope", "authorization_details", "parent_id", "created_at", "expires_at", "revoked_at" FROM `tokens`;--> statement-breakpoint
DROP TABLE `tokens`;--> statement-breakpoint
ALTER TABLE `__new_tokens` RENAME TO `tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_token_hash_unique` ON `tokens` (`token_hash`);