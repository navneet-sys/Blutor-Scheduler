import PermissionVerificationService from '@services/permissionVerification.service';
import { logger } from '../lib/logger';

export async function runPermissionCheck(): Promise<void> {
  const service = new PermissionVerificationService();
  const results = await service.verifyAllCredentials();

  logger.info(
    `Permission check results: ${results.total} total, ` +
    `${results.verified} verified, ${results.revoked} revoked, ${results.failed} failed`,
  );
}
