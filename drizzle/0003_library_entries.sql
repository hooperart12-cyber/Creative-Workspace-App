CREATE TABLE `library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_entries_folder_idx` ON `library_entries` (`folder_id`);
--> statement-breakpoint
CREATE INDEX `library_entries_asset_idx` ON `library_entries` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `library_entries_deleted_idx` ON `library_entries` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `library_entries_name_idx` ON `library_entries` (`name`);
--> statement-breakpoint
INSERT INTO `library_entries` (`id`, `asset_id`, `folder_id`, `name`, `created_at`, `updated_at`, `deleted_at`)
SELECT lower(hex(randomblob(16))), `id`, `folder_id`, `original_name`, `created_at`, `updated_at`, `deleted_at`
FROM `assets`;
--> statement-breakpoint
UPDATE `assets` SET `deleted_at` = NULL;
--> statement-breakpoint
CREATE TABLE `assets__new` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`ext` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`has_alpha` integer,
	`page_count` integer,
	`preview_asset_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`preview_asset_id`) REFERENCES `assets__new`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `assets__new` (`id`, `sha256`, `original_name`, `mime`, `ext`, `bytes`, `width`, `height`, `has_alpha`, `page_count`, `preview_asset_id`, `created_at`, `updated_at`, `deleted_at`)
SELECT `id`, `sha256`, `original_name`, `mime`, `ext`, `bytes`, `width`, `height`, `has_alpha`, `page_count`, `preview_asset_id`, `created_at`, `updated_at`, `deleted_at` FROM `assets`;
--> statement-breakpoint
DROP TABLE `assets`;
--> statement-breakpoint
ALTER TABLE `assets__new` RENAME TO `assets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_sha256_idx` ON `assets` (`sha256`);
