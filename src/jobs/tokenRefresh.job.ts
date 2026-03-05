import TokenRefreshService from '@services/tokenRefresh.service';
import { logger } from '../lib/logger';

export async function runTokenRefresh(): Promise<void> {
  const service = new TokenRefreshService();
  const results = await service.refreshAllExpiringTokens();

  logger.info(
    `Token refresh results: ${results.success} refreshed, ${results.failed} failed`,
  );
}
