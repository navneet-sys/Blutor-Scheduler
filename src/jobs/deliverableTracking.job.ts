import DeliverableTrackingService from '@services/deliverableTracking.service';
import { logger } from '../lib/logger';

export async function runDeliverableTracking(): Promise<void> {
  const service = new DeliverableTrackingService();
  const result = await service.runDetection();

  logger.info(
    `Deliverable tracking results: ${result.projectsProcessed} projects, ${result.postsDetected} posts detected`,
  );
}
