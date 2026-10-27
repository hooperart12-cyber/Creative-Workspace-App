-- M6 tags.
-- SQLite cannot add a CHECK, a new primary key, or a partial unique index by altering a
-- column in place, so `tags` and `taggings` are rebuilt inside this migration's transaction.
-- Every existing row is copied. If a row cannot be represented, the migration aborts and
-- the transaction rolls the copy back. Nothing is deleted to make the data fit.
-- `boards.tag_visibility` is a new column with a constant default, which ALTER TABLE can add.

ALTER TABLE `boards` ADD COLUMN `tag_visibility` text NOT NULL DEFAULT 'hover' CHECK (`tag_visibility` IN ('hidden', 'hover', 'always'));
--> statement-breakpoint
CREATE TEMP TABLE `m6_guard` (`id` integer);
--> statement-breakpoint
CREATE TRIGGER `m6_guard_tags` BEFORE INSERT ON `m6_guard`
WHEN EXISTS (SELECT 1 FROM `tags` WHERE `reusable` = 0)
OR EXISTS (
	SELECT 1 FROM `tags`
	WHERE `reusable` != 0 AND `deleted_at` IS NULL
	GROUP BY lower(trim(`name`))
	HAVING count(*) > 1
)
OR EXISTS (
	SELECT 1 FROM `taggings` WHERE `target_type` NOT IN ('asset', 'entry', 'object', 'board')
)
BEGIN
	SELECT RAISE(ABORT, 'Existing tag data cannot satisfy the M6 rules. Nothing was deleted.');
END;
--> statement-breakpoint
INSERT INTO `m6_guard` (`id`) VALUES (1);
--> statement-breakpoint
DROP TRIGGER `m6_guard_tags`;
--> statement-breakpoint
DROP TABLE `m6_guard`;
--> statement-breakpoint
CREATE TABLE `tags_m6` (
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
			AND `owner_type` IN ('asset', 'entry', 'object', 'board')
			AND `owner_id` IS NOT NULL
			AND `archived_at` IS NULL
		)
	)
);
--> statement-breakpoint
INSERT INTO `tags_m6` (
	`id`, `name`, `normalized_name`, `color`, `reusable`, `owner_type`, `owner_id`,
	`archived_at`, `created_at`, `updated_at`, `deleted_at`
)
SELECT
	`id`,
	trim(`name`),
	lower(trim(`name`)),
	`color`,
	CASE WHEN `reusable` = 0 THEN 0 ELSE 1 END,
	NULL,
	NULL,
	NULL,
	`created_at`,
	`updated_at`,
	`deleted_at`
FROM `tags`;
--> statement-breakpoint
CREATE TABLE `taggings_m6` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CHECK (`target_type` IN ('asset', 'entry', 'object', 'board')),
	FOREIGN KEY (`tag_id`) REFERENCES `tags_m6`(`id`) ON DELETE NO ACTION
);
--> statement-breakpoint
INSERT INTO `taggings_m6` (`id`, `tag_id`, `target_type`, `target_id`, `created_at`)
SELECT lower(hex(randomblob(16))), `tag_id`, `target_type`, `target_id`, `created_at` FROM `taggings`;
--> statement-breakpoint
DROP TABLE `taggings`;
--> statement-breakpoint
DROP TABLE `tags`;
--> statement-breakpoint
ALTER TABLE `tags_m6` RENAME TO `tags`;
--> statement-breakpoint
ALTER TABLE `taggings_m6` RENAME TO `taggings`;
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
