import InstagramService from '@services/instagram.service';
import { PlatformType } from '@interfaces/platforms.interface';
import { PlatformUserDto } from '@dtos/platforms.dto';
import { logger } from '../lib/logger';

export async function runStoryFetch(): Promise<string> {
  const instagramService = new InstagramService(
    {} as any,
    {} as any,
    {} as PlatformUserDto,
    PlatformType.INSTAGRAM,
  );

  const results = await instagramService.fetchAllInstagramStories();

  const summary = `${results.total_platforms} platforms, ${results.successful_fetches} success, ${results.failed_fetches} failed`;
  logger.info(`Story fetch results: ${summary}`);
  return summary;
}
