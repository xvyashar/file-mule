import { CronJob } from 'cron';
import { db } from './db/index.js';
import { queueTable } from './db/schema.js';
import { eq } from 'drizzle-orm';

export function startQueueCleanupCron() {
  return new CronJob(
    '0 0 * * * *',
    async () => {
      const items = await db
        .select({
          id: queueTable.id,
          lastTouched: queueTable.lastTouched,
        })
        .from(queueTable);

      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 1);
      threshold.setMinutes(0, 0, 0);

      for (const item of items) {
        const lastTouched = new Date(item.lastTouched);
        lastTouched.setMinutes(0, 0, 0);

        if (threshold > lastTouched)
          await db.delete(queueTable).where(eq(queueTable.id, item.id));
      }
    },
    null,
    true,
  );
}
