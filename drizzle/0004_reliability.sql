CREATE TABLE `project_state` (
	`id` integer PRIMARY KEY CHECK (`id` = 1),
	`change_revision` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO `project_state` (`id`, `change_revision`) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER `touch_boards_insert` AFTER INSERT ON `boards` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_boards_update` AFTER UPDATE ON `boards` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_boards_delete` AFTER DELETE ON `boards` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_objects_insert` AFTER INSERT ON `board_objects` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_objects_update` AFTER UPDATE ON `board_objects` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_objects_delete` AFTER DELETE ON `board_objects` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_assets_insert` AFTER INSERT ON `assets` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_assets_update` AFTER UPDATE ON `assets` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_assets_delete` AFTER DELETE ON `assets` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_entries_insert` AFTER INSERT ON `library_entries` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_entries_update` AFTER UPDATE ON `library_entries` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_entries_delete` AFTER DELETE ON `library_entries` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_folders_insert` AFTER INSERT ON `folders` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_folders_update` AFTER UPDATE ON `folders` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_folders_delete` AFTER DELETE ON `folders` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `touch_meta_update` AFTER UPDATE ON `project_meta` BEGIN
	UPDATE `project_state` SET `change_revision` = `change_revision` + 1 WHERE `id` = 1;
END;
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
CREATE TABLE `search_documents` (
	`id` integer PRIMARY KEY,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`asset_id` text,
	`page` integer,
	`title` text NOT NULL DEFAULT '',
	`body` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_source_idx` ON `search_documents` (`kind`, `source_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_text` USING fts5(
	`title`,
	`body`,
	content='search_documents',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_names` USING fts5(
	`title`,
	content='search_documents',
	content_rowid='id',
	tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `search_documents_insert` AFTER INSERT ON `search_documents` BEGIN
	INSERT INTO `search_text` (`rowid`, `title`, `body`) VALUES (NEW.`id`, NEW.`title`, NEW.`body`);
	INSERT INTO `search_names` (`rowid`, `title`) VALUES (NEW.`id`, NEW.`title`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_documents_delete` AFTER DELETE ON `search_documents` BEGIN
	INSERT INTO `search_text` (`search_text`, `rowid`, `title`, `body`) VALUES ('delete', OLD.`id`, OLD.`title`, OLD.`body`);
	INSERT INTO `search_names` (`search_names`, `rowid`, `title`) VALUES ('delete', OLD.`id`, OLD.`title`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_board_insert` AFTER INSERT ON `boards` WHEN NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`) VALUES ('board', NEW.`id`, NEW.`title`, NEW.`title`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_board_update` AFTER UPDATE ON `boards` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'board' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'board', NEW.`id`, NEW.`title`, NEW.`title` WHERE NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_board_delete` AFTER DELETE ON `boards` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'board' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_note_insert` AFTER INSERT ON `board_objects` WHEN NEW.`type` = 'text' AND NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`) VALUES (
		'note',
		NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.plainText')), 1, 80), ''), 'Note'),
		COALESCE(json_extract(NEW.`data`, '$.plainText'), '')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `search_note_update` AFTER UPDATE ON `board_objects` WHEN NEW.`type` = 'text' OR OLD.`type` = 'text' BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'note' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT
		'note',
		NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.plainText')), 1, 80), ''), 'Note'),
		COALESCE(json_extract(NEW.`data`, '$.plainText'), '')
	WHERE NEW.`type` = 'text' AND NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_note_delete` AFTER DELETE ON `board_objects` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'note' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entry_insert` AFTER INSERT ON `library_entries` WHEN NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
	SELECT 'entry', NEW.`id`, NEW.`asset_id`, NEW.`name`, `original_name` FROM `assets` WHERE `id` = NEW.`asset_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entry_update` AFTER UPDATE ON `library_entries` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'entry' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
	SELECT 'entry', NEW.`id`, NEW.`asset_id`, NEW.`name`, `original_name`
	FROM `assets` WHERE `id` = NEW.`asset_id` AND NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_entry_delete` AFTER DELETE ON `library_entries` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'entry' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_folder_insert` AFTER INSERT ON `folders` WHEN NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`) VALUES ('folder', NEW.`id`, NEW.`name`, NEW.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_folder_update` AFTER UPDATE ON `folders` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'folder' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'folder', NEW.`id`, NEW.`name`, NEW.`name` WHERE NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_folder_delete` AFTER DELETE ON `folders` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'folder' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_asset_insert` AFTER INSERT ON `assets` BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
	VALUES ('asset', NEW.`id`, NEW.`id`, NEW.`original_name`, NEW.`ext`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_asset_update` AFTER UPDATE ON `assets` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'asset' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
	VALUES ('asset', NEW.`id`, NEW.`id`, NEW.`original_name`, NEW.`ext`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_asset_delete` AFTER DELETE ON `assets` BEGIN
	DELETE FROM `search_documents` WHERE `asset_id` = OLD.`id`;
END;
--> statement-breakpoint
INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
SELECT 'board', `id`, `title`, `title` FROM `boards` WHERE `deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
SELECT
	'note',
	`id`,
	COALESCE(NULLIF(substr(trim(json_extract(`data`, '$.plainText')), 1, 80), ''), 'Note'),
	COALESCE(json_extract(`data`, '$.plainText'), '')
FROM `board_objects` WHERE `type` = 'text' AND `deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
SELECT 'entry', `library_entries`.`id`, `library_entries`.`asset_id`, `library_entries`.`name`, `assets`.`original_name`
FROM `library_entries` JOIN `assets` ON `assets`.`id` = `library_entries`.`asset_id`
WHERE `library_entries`.`deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
SELECT 'folder', `id`, `name`, `name` FROM `folders` WHERE `deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `search_documents` (`kind`, `source_id`, `asset_id`, `title`, `body`)
SELECT 'asset', `id`, `id`, `original_name`, `ext` FROM `assets`;
--> statement-breakpoint
CREATE TABLE `search_jobs` (
	`asset_id` text PRIMARY KEY,
	`state` text NOT NULL,
	`pages_done` integer NOT NULL DEFAULT 0,
	`note` text
);
--> statement-breakpoint
INSERT INTO `search_jobs` (`asset_id`, `state`)
SELECT `id`, 'pending' FROM `assets` WHERE `mime` = 'application/pdf';
--> statement-breakpoint
CREATE TRIGGER `search_pdf_job_insert` AFTER INSERT ON `assets`
WHEN NEW.`mime` = 'application/pdf' BEGIN
	INSERT INTO `search_jobs` (`asset_id`, `state`) VALUES (NEW.`id`, 'pending');
END;
--> statement-breakpoint
CREATE TRIGGER `search_pdf_job_delete` AFTER DELETE ON `assets` BEGIN
	DELETE FROM `search_jobs` WHERE `asset_id` = OLD.`id`;
END;
