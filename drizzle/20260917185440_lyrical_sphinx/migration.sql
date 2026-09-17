CREATE TABLE `chat_actions` (
	`id` text PRIMARY KEY,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY,
	`conversation_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_chat_messages_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_records` (
	`collection_id` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `collection_records_pk` PRIMARY KEY(`collection_id`, `id`),
	CONSTRAINT `fk_collection_records_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`)
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_collections_id_jobs_id_fk` FOREIGN KEY (`id`) REFERENCES `jobs`(`id`),
	CONSTRAINT `fk_collections_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversation_sources` (
	`conversation_id` text NOT NULL,
	`source_id` text NOT NULL,
	CONSTRAINT `conversation_sources_pk` PRIMARY KEY(`conversation_id`, `source_id`),
	CONSTRAINT `fk_conversation_sources_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`),
	CONSTRAINT `fk_conversation_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation` ON `chat_messages` (`conversation_id`);