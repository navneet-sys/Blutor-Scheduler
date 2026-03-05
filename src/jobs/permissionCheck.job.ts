import PermissionVerificationService from '@services/permissionVerification.service';
import { logger } from '../lib/logger';

export async function runPermissionCheck(): Promise<string> {
  const service = new PermissionVerificationService();
  const results = await service.verifyAllCredentials();

  const summary = `${results.total} total, ${results.verified} verified, ${results.revoked} revoked, ${results.failed} failed`;
  logger.info(`Permission check results: ${summary}`);
  return summary;
}
