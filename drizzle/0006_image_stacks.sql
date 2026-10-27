-- M7 image stacks and per-appearance crops.
-- `stack_slides` is new. Tag checks are rebuilt so a slide can own tags. Every existing
-- tag row is copied. If a row uses an unknown target, the migration aborts and the
-- transaction rolls the copy back. Nothing is deleted to make the data fit.
-- Crop data for a standalone image lives in `board_objects.data`, so existing cards are left as they are.

CREATE TABLE `stack_slides` (
	`id` text PRIMARY KEY NOT NULL,
	`stack_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` real NOT NULL DEFAULT 0,
	`crop_x` integer,
	`crop_y` integer,
	`crop_w` integer,
	`crop_h` integer,
	`layout_x` real,
	`layout_y` real,
	`layout_width` real,
	`layout_height` real,
	`layout_rotation` real,
	`layout_crop_x` integer,
	`layout_crop_y` integer,
	`layout_crop_w` integer,
	`layout_crop_h` integer,
	`source_object_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CHECK (
		(`crop_x` IS NULL AND `crop_y` IS NULL AND `crop_w` IS NULL AND `crop_h` IS NULL)
		OR (`crop_x` >= 0 AND `crop_y` >= 0 AND `crop_w` > 0 AND `crop_h` > 0)
	),
	FOREIGN KEY (`stack_id`) REFERENCES `board_objects`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE NO ACTION
);
--> statement-breakpoint
CREATE INDEX `stack_slides_stack_idx` ON `stack_slides` (`stack_id`, `position`);
--> statement-breakpoint
CREATE INDEX `stack_slides_asset_idx` ON `stack_slides` (`asset_id`);
--> statement-breakpoint
CREATE TRIGGER `touch_stack_slides_insert` AFTER INSERT ON `stack_slides` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_stack_slides_update` AFTER UPDATE ON `stack_slides` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_stack_slides_delete` AFTER DELETE ON `stack_slides` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `stack_slides_cleanup_tags` AFTER DELETE ON `stack_slides` BEGIN
	DELETE FROM `taggings` WHERE `target_type` = 'slide' AND `target_id` = OLD.`id`;
	DELETE FROM `tags` WHERE `reusable` = 0 AND `owner_type` = 'slide' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `stack_object_cleanup` AFTER DELETE ON `board_objects` WHEN OLD.`type` = 'stack' BEGIN
	DELETE FROM `stack_slides` WHERE `stack_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TEMP TABLE `m7_guard` (`id` integer);
--> statement-breakpoint
CREATE TRIGGER `m7_guard_tags` BEFORE INSERT ON `m7_guard`
WHEN EXISTS (
	SELECT 1 FROM `taggings` WHERE `target_type` NOT IN ('asset', 'entry', 'object', 'board', 'slide')
)
OR EXISTS (
	SELECT 1 FROM `tags`
	WHERE `reusable` = 0 AND (`owner_type` NOT IN ('asset', 'entry', 'object', 'board', 'slide') OR `owner_id` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'Existing tag data cannot satisfy the M7 rules. Nothing was deleted.');
END;
--> statement-breakpoint
INSERT INTO `m7_guard` (`id`) VALUES (1);
--> statement-breakpoint
DROP TRIGGER `m7_guard_tags`;
--> statement-breakpoint
DROP TABLE `m7_guard`;
--> statement-breakpoint
CREATE TABLE `tags_m7` (
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
			AND `owner_type` IN ('asset', 'entry', 'object', 'board', 'slide')
			AND `owner_id` IS NOT NULL
			AND `archived_at` IS NULL
		)
	)
);
--> statement-breakpoint
INSERT INTO `tags_m7` (
	`id`, `name`, `normalized_name`, `color`, `reusable`, `owner_type`, `owner_id`,
	`archived_at`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
	`id`, `name`, `normalized_name`, `color`, `reusable`, `owner_type`, `owner_id`,
	`archived_at`, `created_at`, `updated_at`, `deleted_at`
FROM `tags`;
--> statement-breakpoint
CREATE TABLE `taggings_m7` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CHECK (`target_type` IN ('asset', 'entry', 'object', 'board', 'slide')),
	FOREIGN KEY (`tag_id`) REFERENCES `tags_m7`(`id`) ON DELETE NO ACTION
);
--> statement-breakpoint
INSERT INTO `taggings_m7` (`id`, `tag_id`, `target_type`, `target_id`, `created_at`)
SELECT `id`, `tag_id`, `target_type`, `target_id`, `created_at` FROM `taggings`;
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
DROP TABLE `taggings`;
--> statement-breakpoint
DROP TABLE `tags`;
--> statement-breakpoint
ALTER TABLE `tags_m7` RENAME TO `tags`;
--> statement-breakpoint
ALTER TABLE `taggings_m7` RENAME TO `taggings`;
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
