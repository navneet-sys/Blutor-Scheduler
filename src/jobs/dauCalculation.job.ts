import AnalyticsService from '@services/analytics.service';
import { formatDateIST, istDayStart } from '@utils/timezone';
import { logger } from '../lib/logger';

/**
 * Runs at midnight IST (0 0 * * *). node-cron can fire a few ms before the
 * clock ticks over, so yesterdayIST() may return 2-days-ago instead of
 * yesterday. Using a 6-hour lookback guarantees we land in the previous
 * calendar day regardless of minor clock drift.
 */
export async function runDAUCalculation(): Promise<string> {
  const service = new AnalyticsService();

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const targetDateStr = formatDateIST(sixHoursAgo);
  const targetDate = istDayStart(targetDateStr);

  const result = await service.calculateAndStoreDailyActiveUsers(targetDate);
  const summary = `DAU for ${result.date}: ${result.count} active users`;
  logger.info(summary);
  return summary;
}

/**
 * Manual backfill: recalculate DAU for a date range.
 * Usage: node dist/run-job.js dau-backfill 2026-04-26 [2026-04-26]
 */
export async function runDAUBackfill(startDateStr: string, endDateStr: string): Promise<string> {
  const service = new AnalyticsService();
  const start = istDayStart(startDateStr);
  const end = istDayStart(endDateStr);
  const result = await service.backfillDailyActiveUsers(start, end);
  const summary = `Backfill ${startDateStr} to ${endDateStr}: ${result.success} succeeded, ${result.failed} failed`;
  logger.info(summary);
  return summary;
}
