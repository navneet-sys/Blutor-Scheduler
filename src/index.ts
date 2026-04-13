import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from './lib/db';
import { registerJob, startAllJobs, stopAllJobs } from './lib/scheduler';
import { logger } from './lib/logger';
import { CRON_SCHEDULES } from './config';

// Job imports
import { runStoryFetch } from './jobs/storyFetch.job';
import { runTokenRefresh } from './jobs/tokenRefresh.job';
import { runPermissionCheck } from './jobs/permissionCheck.job';
import { runDeliverableTracking } from './jobs/deliverableTracking.job';
import { runDAUCalculation } from './jobs/dauCalculation.job';
import { runCreatorDataRefresh } from './jobs/creatorDataRefresh.job';
import { runICMDailyReport } from './jobs/icmDailyReport.job';
import { runNotificationDigest } from './jobs/notificationDigest.job';
import { PlatformType } from '@interfaces/platforms.interface';

async function main() {
  logger.info('=== Blutor Scheduler starting ===');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(
    `Telegram alerts: ${process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? 'enabled' : 'DISABLED (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)'}`,
  );
  logger.info(
    `Gmail (digest): ${process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY_FOR_MAIL ? 'env present' : 'missing GOOGLE_* (digest emails will fail when sending)'}`,
  );

  await connectDatabase();

  // --- Existing jobs (migrated from backend) ---

  registerJob({
    name: 'story-fetch',
    schedule: CRON_SCHEDULES.STORY_FETCH,
    handler: runStoryFetch,
    lockTtlHours: 3,
  });

  registerJob({
    name: 'token-refresh',
    schedule: CRON_SCHEDULES.TOKEN_REFRESH,
    handler: runTokenRefresh,
    lockTtlHours: 2,
  });

  registerJob({
    name: 'permission-check',
    schedule: CRON_SCHEDULES.PERMISSION_CHECK,
    handler: runPermissionCheck,
    lockTtlHours: 2,
  });

  registerJob({
    name: 'deliverable-tracking',
    schedule: CRON_SCHEDULES.DELIVERABLE_TRACKING,
    handler: runDeliverableTracking,
    lockTtlHours: 2,
  });

  registerJob({
    name: 'dau-calculation',
    schedule: CRON_SCHEDULES.DAU_CALCULATION,
    handler: runDAUCalculation,
    lockTtlHours: 1,
  });

  // --- New creator data refresh jobs (staggered by platform) ---

  registerJob({
    name: 'creator-refresh-instagram',
    schedule: CRON_SCHEDULES.INSTAGRAM_REFRESH,
    handler: () => runCreatorDataRefresh(PlatformType.INSTAGRAM),
    lockTtlHours: 4,
  });

  registerJob({
    name: 'creator-refresh-youtube',
    schedule: CRON_SCHEDULES.YOUTUBE_REFRESH,
    handler: () => runCreatorDataRefresh(PlatformType.YOUTUBE),
    lockTtlHours: 4,
  });

  registerJob({
    name: 'creator-refresh-tiktok',
    schedule: CRON_SCHEDULES.TIKTOK_REFRESH,
    handler: () => runCreatorDataRefresh(PlatformType.TIKTOK),
    lockTtlHours: 4,
  });

  registerJob({
    name: 'creator-refresh-facebook',
    schedule: CRON_SCHEDULES.FACEBOOK_REFRESH,
    handler: () => runCreatorDataRefresh(PlatformType.FACEBOOK),
    lockTtlHours: 4,
  });

  // --- ICM daily report (Google Sheets) ---

  registerJob({
    name: 'icm-daily-report',
    schedule: CRON_SCHEDULES.ICM_DAILY_REPORT,
    handler: runICMDailyReport,
    lockTtlHours: 1,
  });

  registerJob({
    name: 'notification-digest',
    schedule: CRON_SCHEDULES.NOTIFICATION_DIGEST,
    handler: runNotificationDigest,
    lockTtlHours: 1,
  });

  startAllJobs();
  logger.info('=== Blutor Scheduler is running ===');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopAllJobs();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
  });
  process.on('unhandledRejection', (reason: any) => {
    logger.error(`Unhandled rejection: ${reason?.message || reason}`);
  });
}

main().catch((err) => {
  logger.error(`Scheduler failed to start: ${err.message}`);
  process.exit(1);
});
