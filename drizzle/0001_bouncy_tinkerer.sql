CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`agent_id` text,
	`agent_display_name` text,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`order_number` integer,
	`amount_cents` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
