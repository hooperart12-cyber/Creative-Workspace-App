-- M9 page collections. Existing boards, assets, tags, and stack slides are left in place.
-- New tables only. A page row is not an asset, and a collection is not a canvas card.
-- Tag checks are rebuilt so a page can carry the same tags as a card. Every existing tag row is copied.

CREATE TABLE `collection_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `collection_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_folders_parent_idx` ON `collection_folders` (`parent_id`);
--> statement-breakpoint
CREATE TABLE `collection_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`template_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_asset_id` text,
	`direction` text DEFAULT 'ltr' NOT NULL,
	`first_page_side` text DEFAULT 'right' NOT NULL,
	`number_start` integer DEFAULT 1 NOT NULL,
	`planner_view` text DEFAULT 'grid' NOT NULL,
	`grid_density` text DEFAULT 'balanced' NOT NULL,
	`grid_size` real DEFAULT 160 NOT NULL,
	`spread_zoom` real DEFAULT 1 NOT NULL,
	`overall_status` text DEFAULT 'not_started' NOT NULL,
	`sort_order` real DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`next_collection_id` text,
	`reader_page_id` text,
	`reader_layout` text DEFAULT 'single' NOT NULL,
	`reader_zoom` real DEFAULT 1 NOT NULL,
	`reader_x` real DEFAULT 0 NOT NULL,
	`reader_y` real DEFAULT 0 NOT NULL,
	`reader_interacted_at` integer,
	`planner_page_id` text,
	`planner_anchor` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `collection_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collections_folder_idx` ON `collections` (`folder_id`);
--> statement-breakpoint
CREATE TABLE `collection_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`removed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_stages_collection_idx` ON `collection_stages` (`collection_id`, `position`);
--> statement-breakpoint
CREATE TABLE `collection_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`unnumbered` integer,
	`role` text,
	`notes` text DEFAULT '' NOT NULL,
	`overall_status` text DEFAULT 'not_started' NOT NULL,
	`displayed_version_id` text,
	`span` integer DEFAULT 1 NOT NULL,
	`spread_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_pages_collection_idx` ON `collection_pages` (`collection_id`, `position`);
--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`asset_id` text NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`crop_x` integer,
	`crop_y` integer,
	`crop_w` integer,
	`crop_h` integer,
	`source_slide_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `collection_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_versions_page_idx` ON `page_versions` (`page_id`, `position`);
--> statement-breakpoint
CREATE TABLE `page_stage_states` (
	`page_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`state` text DEFAULT 'not_started' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	PRIMARY KEY (`page_id`, `stage_id`),
	FOREIGN KEY (`page_id`) REFERENCES `collection_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `collection_stages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection_nav` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`page_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`) REFERENCES `collection_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_nav_collection_idx` ON `collection_nav` (`collection_id`, `position`);
--> statement-breakpoint
CREATE TABLE `page_links` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`destination` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `collection_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_links_page_idx` ON `page_links` (`page_id`);
--> statement-breakpoint
CREATE TABLE `page_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `collection_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_comments_page_idx` ON `page_comments` (`page_id`);
--> statement-breakpoint
CREATE TABLE `page_comment_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`comment_id`) REFERENCES `page_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_comment_messages_comment_idx` ON `page_comment_messages` (`comment_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `touch_collections_insert` AFTER INSERT ON `collections` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_collections_update` AFTER UPDATE ON `collections` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_collection_pages_insert` AFTER INSERT ON `collection_pages` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_collection_pages_update` AFTER UPDATE ON `collection_pages` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
DROP TRIGGER `touch_tags_insert`;
--> statement-breakpoint
DROP TRIGGER `touch_tags_update`;
--> statement-breakpoint
DROP TRIGGER `touch_tags_delete`;
--> statement-breakpoint
DROP TRIGGER `touch_taggings_insert`;
--> statement-breakpoint
DROP TRIGGER `touch_taggings_delete`;
--> statement-breakpoint
DROP TRIGGER `tags_cleanup_assets`;
--> statement-breakpoint
DROP TRIGGER `tags_cleanup_entries`;
--> statement-breakpoint
DROP TRIGGER `tags_cleanup_objects`;
--> statement-breakpoint
DROP TRIGGER `tags_cleanup_boards`;
--> statement-breakpoint
DROP TRIGGER `stack_slides_cleanup_tags`;
--> statement-breakpoint
CREATE TEMP TABLE `m9_guard` (`id` integer);
--> statement-breakpoint
CREATE TRIGGER `m9_guard_tags` BEFORE INSERT ON `m9_guard`
WHEN EXISTS (
	SELECT 1 FROM `taggings` WHERE `target_type` NOT IN ('asset', 'entry', 'object', 'board', 'slide')
)
OR EXISTS (
	SELECT 1 FROM `tags`
	WHERE `reusable` = 0 AND (`owner_type` NOT IN ('asset', 'entry', 'object', 'board', 'slide') OR `owner_id` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'Existing tag data cannot satisfy the M9 rules. Nothing was deleted.');
END;
--> statement-breakpoint
INSERT INTO `m9_guard` (`id`) VALUES (1);
--> statement-breakpoint
DROP TRIGGER `m9_guard_tags`;
--> statement-breakpoint
DROP TABLE `m9_guard`;
--> statement-breakpoint
CREATE TABLE `tags_m9` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text,
	`reusable` integer NOT NULL DEFAULT 1,
	`owner_type` text,
	`owner_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CHECK (`color` IS NULL OR `color` GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
	CHECK (`reusable` IN (0, 1)),
	CHECK (
		(`reusable` = 1 AND `owner_type` IS NULL AND `owner_id` IS NULL)
		OR (
			`reusable` = 0
			AND `owner_type` IN ('asset', 'entry', 'object', 'board', 'slide', 'page')
			AND `owner_id` IS NOT NULL
			AND `archived_at` IS NULL
		)
	)
);
--> statement-breakpoint
INSERT INTO `tags_m9` (
	`id`, `name`, `normalized_name`, `color`, `reusable`, `owner_type`, `owner_id`,
	`archived_at`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
	`id`, `name`, `normalized_name`, `color`, `reusable`, `owner_type`, `owner_id`,
	`archived_at`, `created_at`, `updated_at`, `deleted_at`
FROM `tags`;
--> statement-breakpoint
CREATE TABLE `taggings_m9` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CHECK (`target_type` IN ('asset', 'entry', 'object', 'board', 'slide', 'page')),
	FOREIGN KEY (`tag_id`) REFERENCES `tags_m9`(`id`) ON DELETE NO ACTION
);
--> statement-breakpoint
INSERT INTO `taggings_m9` (`id`, `tag_id`, `target_type`, `target_id`, `created_at`)
SELECT `id`, `tag_id`, `target_type`, `target_id`, `created_at` FROM `taggings`;
--> statement-breakpoint
DROP TABLE `taggings`;
--> statement-breakpoint
DROP TABLE `tags`;
--> statement-breakpoint
ALTER TABLE `tags_m9` RENAME TO `tags`;
--> statement-breakpoint
ALTER TABLE `taggings_m9` RENAME TO `taggings`;
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_reusable_name_idx` ON `tags` (`normalized_name`) WHERE `reusable` = 1 AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_oneoff_owner_idx` ON `tags` (`owner_type`, `owner_id`, `normalized_name`) WHERE `reusable` = 0 AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `taggings_target_tag_idx` ON `taggings` (`tag_id`, `target_type`, `target_id`);
--> statement-breakpoint
CREATE INDEX `taggings_target_idx` ON `taggings` (`target_type`, `target_id`);
--> statement-breakpoint
CREATE TRIGGER `touch_tags_insert` AFTER INSERT ON `tags` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_tags_update` AFTER UPDATE ON `tags` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_tags_delete` AFTER DELETE ON `tags` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_taggings_insert` AFTER INSERT ON `taggings` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_taggings_delete` AFTER DELETE ON `taggings` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_cleanup_assets` AFTER DELETE ON `assets` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'asset' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'asset' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_cleanup_entries` AFTER DELETE ON `library_entries` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'entry' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'entry' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_cleanup_objects` AFTER DELETE ON `board_objects` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'object' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'object' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `tags_cleanup_boards` AFTER DELETE ON `boards` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'board' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'board' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `stack_slides_cleanup_tags` AFTER DELETE ON `stack_slides` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'slide' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'slide' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `collection_pages_cleanup_tags` AFTER DELETE ON `collection_pages` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'page' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'page' AND `owner_id` = OLD.`id`;
END;
