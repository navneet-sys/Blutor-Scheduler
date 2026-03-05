import AnalyticsService from '@services/analytics.service';
import { logger } from '../lib/logger';

export async function runDAUCalculation(): Promise<void> {
  const service = new AnalyticsService();

  // Calculate yesterday's DAU
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const result = await service.calculateAndStoreDailyActiveUsers(yesterday);
  logger.info(`DAU for ${result.date}: ${result.count} active users`);
}
