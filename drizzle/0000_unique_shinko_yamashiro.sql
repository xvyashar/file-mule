CREATE TABLE `Queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userTg` integer NOT NULL,
	`fileHash` text,
	`chunks` integer,
	`completedChunks` integer DEFAULT 0,
	`lastChunkStatus` text DEFAULT 'NOT-STARTED',
	`addresses` text DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE `States` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `Users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegramId` integer NOT NULL,
	`irSocial` text NOT NULL,
	`irSocialId` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Users_telegramId_unique` ON `Users` (`telegramId`);