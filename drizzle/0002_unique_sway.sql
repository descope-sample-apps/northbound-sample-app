PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_carts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer,
	`token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- drizzle-kit generated `SELECT "token" FROM "carts"` here, which cannot run: the
-- old table is the one without that column. Existing carts all belong to a
-- customer, so their token is NULL.
INSERT INTO `__new_carts`("id", "customer_id", "token", "created_at", "updated_at") SELECT "id", "customer_id", NULL, "created_at", "updated_at" FROM `carts`;--> statement-breakpoint
DROP TABLE `carts`;--> statement-breakpoint
ALTER TABLE `__new_carts` RENAME TO `carts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `carts_customer_id_unique` ON `carts` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `carts_token_unique` ON `carts` (`token`);