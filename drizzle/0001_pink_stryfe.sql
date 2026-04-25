PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_Queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userTg` integer NOT NULL,
	`fileType` text NOT NULL,
	`fileHash` text NOT NULL,
	`filePassword` text,
	`chunks` integer DEFAULT 1,
	`completedChunks` integer DEFAULT 0,
	`lastChunkStatus` text DEFAULT 'NOT-STARTED',
	`addresses` text DEFAULT '',
	`lastTouched` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Queue`("id", "userTg", "fileType", "fileHash", "filePassword", "chunks", "completedChunks", "lastChunkStatus", "addresses", "lastTouched") SELECT "id", "userTg", "fileType", "fileHash", "filePassword", "chunks", "completedChunks", "lastChunkStatus", "addresses", "lastTouched" FROM `Queue`;--> statement-breakpoint
DROP TABLE `Queue`;--> statement-breakpoint
ALTER TABLE `__new_Queue` RENAME TO `Queue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;