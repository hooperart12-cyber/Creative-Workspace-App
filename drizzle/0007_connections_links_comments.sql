-- M8 connections, links, and comments. Existing boards, tags, and stack slides are left in place.
-- New columns have defaults, so an older project opens with adaptive connections and open comments.

ALTER TABLE `boards` ADD `connection_display` text NOT NULL DEFAULT 'adaptive';
--> statement-breakpoint
ALTER TABLE `boards` ADD `crossing_style` text NOT NULL DEFAULT 'plain';
--> statement-breakpoint
ALTER TABLE `boards` ADD `comment_view` text NOT NULL DEFAULT 'open';
--> statement-breakpoint
CREATE TABLE `comment_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`body` text NOT NULL,
	`edited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`comment_id`) REFERENCES `board_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_messages_comment_idx` ON `comment_messages` (`comment_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `link_previews` (
	`object_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`description` text,
	`image_file` text,
	`fetched_at` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`object_id`) REFERENCES `board_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TRIGGER `search_connection_insert` AFTER INSERT ON `board_objects` WHEN NEW.`type` = 'connection' AND NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`) VALUES (
		'connection',
		NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.label.text')), 1, 80), ''), 'Connection'),
		trim(COALESCE(json_extract(NEW.`data`, '$.label.text'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.labelLink.title'), '') || ' ' || COALESCE((
			SELECT group_concat(COALESCE(a.`original_name`, lb.`title`, ''), ' ')
			FROM `board_objects` o
			LEFT JOIN `assets` a ON a.`id` = o.`asset_id`
			LEFT JOIN `boards` lb ON lb.`id` = o.`linked_board_id`
			WHERE o.`id` = json_extract(NEW.`data`, '$.start.attachment.id')
				OR o.`id` = json_extract(NEW.`data`, '$.end.attachment.id')
		), ''))
	);
END;
--> statement-breakpoint
CREATE TRIGGER `search_connection_update` AFTER UPDATE ON `board_objects` WHEN NEW.`type` = 'connection' OR OLD.`type` = 'connection' BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'connection' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'connection', NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.label.text')), 1, 80), ''), 'Connection'),
		trim(COALESCE(json_extract(NEW.`data`, '$.label.text'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.labelLink.title'), '') || ' ' || COALESCE((
			SELECT group_concat(COALESCE(a.`original_name`, lb.`title`, ''), ' ')
			FROM `board_objects` o
			LEFT JOIN `assets` a ON a.`id` = o.`asset_id`
			LEFT JOIN `boards` lb ON lb.`id` = o.`linked_board_id`
			WHERE o.`id` = json_extract(NEW.`data`, '$.start.attachment.id')
				OR o.`id` = json_extract(NEW.`data`, '$.end.attachment.id')
		), ''))
	WHERE NEW.`type` = 'connection' AND NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_connection_delete` AFTER DELETE ON `board_objects` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'connection' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_link_insert` AFTER INSERT ON `board_objects` WHEN NEW.`type` = 'link' AND NEW.`deleted_at` IS NULL BEGIN
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`) VALUES (
		'link',
		NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.title')), 1, 80), ''), 'Link'),
		trim(COALESCE(json_extract(NEW.`data`, '$.title'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.description'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.destination.href'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.destination.title'), ''))
	);
END;
--> statement-breakpoint
CREATE TRIGGER `search_link_update` AFTER UPDATE ON `board_objects` WHEN NEW.`type` = 'link' OR OLD.`type` = 'link' BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'link' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'link', NEW.`id`,
		COALESCE(NULLIF(substr(trim(json_extract(NEW.`data`, '$.title')), 1, 80), ''), 'Link'),
		trim(COALESCE(json_extract(NEW.`data`, '$.title'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.description'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.destination.href'), '') || ' ' || COALESCE(json_extract(NEW.`data`, '$.destination.title'), ''))
	WHERE NEW.`type` = 'link' AND NEW.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_link_delete` AFTER DELETE ON `board_objects` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'link' AND `source_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comment_refresh` AFTER INSERT ON `comment_messages` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'comment' AND `source_id` = NEW.`comment_id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'comment', o.`id`,
		COALESCE(NULLIF(substr(trim((SELECT m.`body` FROM `comment_messages` m WHERE m.`comment_id` = o.`id` AND m.`deleted_at` IS NULL ORDER BY m.`created_at` LIMIT 1)), 1, 80), ''), 'Comment'),
		COALESCE((SELECT group_concat(m.`body`, ' ') FROM `comment_messages` m WHERE m.`comment_id` = o.`id` AND m.`deleted_at` IS NULL), '')
	FROM `board_objects` o
	WHERE o.`id` = NEW.`comment_id` AND o.`type` = 'comment' AND o.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comment_message_update` AFTER UPDATE ON `comment_messages` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'comment' AND `source_id` = NEW.`comment_id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'comment', o.`id`,
		COALESCE(NULLIF(substr(trim((SELECT m.`body` FROM `comment_messages` m WHERE m.`comment_id` = o.`id` AND m.`deleted_at` IS NULL ORDER BY m.`created_at` LIMIT 1)), 1, 80), ''), 'Comment'),
		COALESCE((SELECT group_concat(m.`body`, ' ') FROM `comment_messages` m WHERE m.`comment_id` = o.`id` AND m.`deleted_at` IS NULL), '')
	FROM `board_objects` o
	WHERE o.`id` = NEW.`comment_id` AND o.`type` = 'comment' AND o.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comment_message_delete` AFTER DELETE ON `comment_messages` BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'comment' AND `source_id` = OLD.`comment_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comment_object` AFTER UPDATE ON `board_objects` WHEN NEW.`type` = 'comment' OR OLD.`type` = 'comment' BEGIN
	DELETE FROM `search_documents` WHERE `kind` = 'comment' AND `source_id` = OLD.`id`;
	INSERT INTO `search_documents` (`kind`, `source_id`, `title`, `body`)
	SELECT 'comment', NEW.`id`,
		COALESCE(NULLIF(substr(trim((SELECT m.`body` FROM `comment_messages` m WHERE m.`comment_id` = NEW.`id` AND m.`deleted_at` IS NULL ORDER BY m.`created_at` LIMIT 1)), 1, 80), ''), 'Comment'),
		COALESCE((SELECT group_concat(m.`body`, ' ') FROM `comment_messages` m WHERE m.`comment_id` = NEW.`id` AND m.`deleted_at` IS NULL), '')
	WHERE NEW.`type` = 'comment' AND NEW.`deleted_at` IS NULL;
END;
