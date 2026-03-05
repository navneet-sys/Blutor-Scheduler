import AnalyticsService from '@services/analytics.service';
import { logger } from '../lib/logger';

export async function runDAUCalculation(): Promise<string> {
  const service = new AnalyticsService();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const result = await service.calculateAndStoreDailyActiveUsers(yesterday);
  const summary = `DAU for ${result.date}: ${result.count} active users`;
  logger.info(summary);
  return summary;
}
