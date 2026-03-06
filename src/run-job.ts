import { connectDatabase, disconnectDatabase } from './lib/db';
import { acquireLock, releaseLock } from './lib/lock';
import { sendTelegramMessage } from './lib/telegram';
import { logger } from './lib/logger';

import { runStoryFetch } from './jobs/storyFetch.job';
import { runTokenRefresh } from './jobs/tokenRefresh.job';
import { runPermissionCheck } from './jobs/permissionCheck.job';
import { runDeliverableTracking } from './jobs/deliverableTracking.job';
import { runDAUCalculation } from './jobs/dauCalculation.job';
import { runCreatorDataRefresh } from './jobs/creatorDataRefresh.job';
import { PlatformType } from '@interfaces/platforms.interface';

const JOBS: Record<string, () => Promise<string | void>> = {
  'story-fetch': runStoryFetch,
  'token-refresh': runTokenRefresh,
  'permission-check': runPermissionCheck,
  'deliverable-tracking': runDeliverableTracking,
  'dau-calculation': runDAUCalculation,
  'creator-refresh-instagram': () => runCreatorDataRefresh(PlatformType.INSTAGRAM),
  'creator-refresh-youtube': () => runCreatorDataRefresh(PlatformType.YOUTUBE),
  'creator-refresh-tiktok': () => runCreatorDataRefresh(PlatformType.TIKTOK),
  'creator-refresh-facebook': () => runCreatorDataRefresh(PlatformType.FACEBOOK),
  'creator-refresh-all': async () => {
    const results: string[] = [];
    for (const type of [PlatformType.INSTAGRAM, PlatformType.YOUTUBE, PlatformType.TIKTOK, PlatformType.FACEBOOK]) {
      const summary = await runCreatorDataRefresh(type);
      results.push(summary);
    }
    return results.join('\n');
  },
};

async function main() {
  const jobName = process.argv[2];

  if (!jobName || !JOBS[jobName]) {
    console.log('Usage: node dist/run-job.js <job-name>\n');
    console.log('Available jobs:');
    Object.keys(JOBS).forEach(name => console.log(`  - ${name}`));
    process.exit(1);
  }

  logger.info(`[MANUAL] Running job: ${jobName}`);
  await connectDatabase();

  const lockName = `job:${jobName}`;
  const lock = await acquireLock(lockName, 4);
  if (!lock) {
    logger.error(`Could not acquire lock for ${jobName} -- another run is in progress`);
    await disconnectDatabase();
    process.exit(1);
  }

  const startTime = Date.now();
  try {
    const summary = await JOBS[jobName]();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[MANUAL] Job "${jobName}" completed in ${elapsed}s`);
    if (summary) logger.info(`[MANUAL] Summary: ${summary}`);

    await sendTelegramMessage(
      [`Blutor Scheduler -- Manual Job Completed`, ``, `Job: ${jobName}`, `Summary: ${summary || 'done'}`, `Duration: ${elapsed}s`].join('\n'),
    );
  } catch (error: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error(`[MANUAL] Job "${jobName}" failed after ${elapsed}s: ${error.message}`);
    await sendTelegramMessage(
      [`Blutor Scheduler -- Manual Job Failed`, ``, `Job: ${jobName}`, `Error: ${error.message}`, `Duration: ${elapsed}s`].join('\n'),
    );
  } finally {
    await releaseLock(lockName);
    await disconnectDatabase();
    process.exit(0);
  }
}

main().catch(err => {
  logger.error(`[MANUAL] Failed: ${err.message}`);
  process.exit(1);
});
