import DeliverableTrackingService from '@services/deliverableTracking.service';
import { logger } from '../lib/logger';

export async function runDeliverableTracking(): Promise<string> {
  const service = new DeliverableTrackingService();
  const result = await service.runDetection();

  const summary = `${result.projectsProcessed} projects, ${result.postsDetected} posts detected`;
  logger.info(`Deliverable tracking results: ${summary}`);
  return summary;
}
