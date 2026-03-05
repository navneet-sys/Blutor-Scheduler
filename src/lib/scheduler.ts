import cron from 'node-cron';
import { acquireLock, releaseLock } from './lock';
import { logger } from './logger';
import { SCHEDULER_CONFIG } from '../config';

interface JobDefinition {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  lockTtlHours?: number;
}

const registeredJobs: cron.ScheduledTask[] = [];

/**
 * Register a cron job with automatic distributed locking.
 * The job acquires a MongoDB lock before execution and releases it after,
 * preventing duplicate runs across restarts or multiple instances.
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

      const lock = await acquireLock(lockName, lockTtlHours);
      if (!lock) {
        logger.info(`Job "${name}" skipped -- lock held by another run`);
        return;
      }

      const startTime = Date.now();
      try {
        await handler();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`Job "${name}" completed in ${elapsed}s`);
      } catch (error: any) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.error(`Job "${name}" failed after ${elapsed}s: ${error.message}`);
      } finally {
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
