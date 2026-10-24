CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`ext` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`has_alpha` integer,
	`folder_id` text,
	`preview_asset_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preview_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_sha256_idx` ON `assets` (`sha256`);--> statement-breakpoint
CREATE INDEX `assets_folder_idx` ON `assets` (`folder_id`);--> statement-breakpoint
CREATE TABLE `board_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`type` text NOT NULL,
	`x` real DEFAULT 0 NOT NULL,
	`y` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 100 NOT NULL,
	`height` real DEFAULT 100 NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`z_index` real DEFAULT 0 NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`group_id` text,
	`asset_id` text,
	`linked_board_id` text,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_objects_board_idx` ON `board_objects` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_objects_asset_idx` ON `board_objects` (`asset_id`);--> statement-breakpoint
CREATE INDEX `board_objects_linked_board_idx` ON `board_objects` (`linked_board_id`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_board_id` text,
	`title` text NOT NULL,
	`cover_asset_id` text,
	`viewport_x` real DEFAULT 0 NOT NULL,
	`viewport_y` real DEFAULT 0 NOT NULL,
	`viewport_zoom` real DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent_board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `boards_parent_idx` ON `boards` (`parent_board_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `folders_parent_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE TABLE `project_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`main_board_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `taggings` (
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`tag_id`, `target_type`, `target_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `taggings_target_idx` ON `taggings` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`reusable` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `tags_name_idx` ON `tags` (`name`);