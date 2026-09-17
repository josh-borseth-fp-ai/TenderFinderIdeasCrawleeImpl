-- Adopt the original onboarding tables without discarding saved sources.
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_events_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jobs` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_jobs_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_messages_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sources` (
	`id` text PRIMARY KEY,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `versions` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_source_cursor` ON `events` (`source_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_source` ON `jobs` (`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_source` ON `messages` (`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `versions_source` ON `versions` (`source_id`);