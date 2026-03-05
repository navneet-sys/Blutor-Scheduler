import TokenRefreshService from '@services/tokenRefresh.service';
import { logger } from '../lib/logger';

export async function runTokenRefresh(): Promise<string> {
  const service = new TokenRefreshService();
  const results = await service.refreshAllExpiringTokens();

  const summary = `${results.success} refreshed, ${results.failed} failed`;
  logger.info(`Token refresh results: ${summary}`);
  return summary;
}
