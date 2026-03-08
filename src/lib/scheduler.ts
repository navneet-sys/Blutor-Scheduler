import cron from 'node-cron';
import moment from 'moment-timezone';
import { acquireLock, releaseLock, renewLock } from './lock';
import { logger } from './logger';
import { sendTelegramMessage } from './telegram';
import { SCHEDULER_CONFIG } from '../config';

interface JobDefinition {
  name: string;
  schedule: string;
  handler: () => Promise<string | void>;
  lockTtlHours?: number;
}

const registeredJobs: cron.ScheduledTask[] = [];

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function formatDuration(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec % 60).toFixed(0);
  return `${min}m ${sec}s`;
}

/**
 * Register a cron job with automatic distributed locking.
 * The job acquires a MongoDB lock before execution and releases it after,
 * preventing duplicate runs across restarts or multiple instances.
 * Long-running jobs get automatic lock renewal and heartbeat notifications.
 */
export function registerJob(job: JobDefinition): void {
  const { name, schedule, handler, lockTtlHours = SCHEDULER_CONFIG.LOCK_TTL_HOURS } = job;

  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron expression for job "${name}": ${schedule}`);
    return;
  }

  const task = cron.schedule(
    schedule,
    async () => {
      const lockName = `job:${name}`;
      logger.info(`Job "${name}" triggered by schedule`);

      let lock: string | null;
      try {
        lock = await acquireLock(lockName, lockTtlHours);
      } catch (lockError: any) {
        logger.error(`Job "${name}" lock error: ${lockError.message}`);
        const timestamp = moment().tz(SCHEDULER_CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
        await sendTelegramMessage(
          [
            `Blutor Scheduler -- Lock Error`,
            ``,
            `Job: ${name}`,
            `Error: ${lockError.message}`,
            `Time: ${timestamp} IST`,
          ].join('\n'),
        );
        return;
      }

      if (!lock) {
        logger.info(`Job "${name}" skipped -- lock held by another run`);
        return;
      }

      const startTime = Date.now();

      // Renew the lock at half the TTL interval so it never expires mid-run
      const renewalMs = (lockTtlHours * 60 * 60 * 1000) / 2;
      const renewalTimer = setInterval(async () => {
        const renewed = await renewLock(lockName, lockTtlHours);
        if (!renewed) {
          logger.warn(`Job "${name}" lock renewal failed -- lock may have been lost`);
        }
      }, renewalMs);

      // Send a heartbeat Telegram message for long-running jobs
      const heartbeatTimer = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const timestamp = moment().tz(SCHEDULER_CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
        await sendTelegramMessage(
          [
            `Blutor Scheduler -- Heartbeat`,
            ``,
            `Job: ${name}`,
            `Status: Still running`,
            `Elapsed: ${formatDuration(elapsed)}`,
            `Time: ${timestamp} IST`,
          ].join('\n'),
        ).catch(err => logger.error(`Heartbeat notification failed for "${name}": ${err.message}`));
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const summary = await handler();
        const elapsed = Date.now() - startTime;
        const duration = formatDuration(elapsed);
        logger.info(`Job "${name}" completed in ${duration}`);

        const timestamp = moment().tz(SCHEDULER_CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
        const lines = [
          `Blutor Scheduler -- Job Completed`,
          ``,
          `Job: ${name}`,
          `Status: Success`,
          `Duration: ${duration}`,
        ];
        if (summary) lines.push(`Summary: ${summary}`);
        lines.push(`Time: ${timestamp} IST`);

        await sendTelegramMessage(lines.join('\n'));
      } catch (error: any) {
        const elapsed = Date.now() - startTime;
        const duration = formatDuration(elapsed);
        logger.error(`Job "${name}" failed after ${duration}: ${error.message}`);

        const timestamp = moment().tz(SCHEDULER_CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
        await sendTelegramMessage(
          [
            `Blutor Scheduler -- Job Failed`,
            ``,
            `Job: ${name}`,
            `Status: Failed`,
            `Duration: ${duration}`,
            `Error: ${error.message}`,
            `Time: ${timestamp} IST`,
          ].join('\n'),
        );
      } finally {
        clearInterval(renewalTimer);
        clearInterval(heartbeatTimer);
        await releaseLock(lockName);
      }
    },
    {
      scheduled: false,
      timezone: SCHEDULER_CONFIG.TIMEZONE,
    },
  );

  registeredJobs.push(task);
  logger.info(`Job registered: "${name}" [${schedule}] (tz: ${SCHEDULER_CONFIG.TIMEZONE})`);
}

/**
 * Start all registered cron jobs.
 */
export function startAllJobs(): void {
  registeredJobs.forEach(task => task.start());
  logger.info(`Started ${registeredJobs.length} scheduled jobs`);
}

/**
 * Stop all registered cron jobs (for graceful shutdown).
 */
export function stopAllJobs(): void {
  registeredJobs.forEach(task => task.stop());
  logger.info('All scheduled jobs stopped');
}
