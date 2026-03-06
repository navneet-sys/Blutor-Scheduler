import platformModel from '@models/platforms.model';
import platformCredentialModel from '@models/platformCredentials.model';
import platformAnalyticsModel from '@/models/platformAnalytics.model';
import { Platform, PlatformCredentials, PlatformType } from '@interfaces/platforms.interface';
import { PlatformUserDto } from '@dtos/platforms.dto';
import { isAnalyticsStale } from '@constants/metrics';
import { logger } from '../lib/logger';
import { chunk, sleep, withTimeout } from '../lib/utils';
import { SCHEDULER_CONFIG } from '../config';

import PlatformService from '@services/platform.service';
import PlatformAudienceService from '@services/platformAudience.service';
import InstagramService from '@services/instagram.service';
import GoogleService from '@services/google.service';
import FacebookService from '@services/facebook.service';

const DUMMY_REQ = {} as any;
const DUMMY_RES = {} as any;
const DUMMY_USER = {} as PlatformUserDto;

/**
 * Main entry point: refresh all creator data for a given platform type.
 * Called on a staggered schedule (Instagram at 1 AM, YouTube at 2 AM, etc.)
 */
export async function runCreatorDataRefresh(platformType: PlatformType): Promise<string> {
  const platforms = await platformModel.find({ type: platformType }).lean();

  if (platforms.length === 0) {
    logger.info(`No ${platformType} platforms found, skipping refresh`);
    return `${platformType}: 0 platforms found`;
  }

  logger.info(`Starting ${platformType} creator data refresh for ${platforms.length} platforms`);

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  const batches = chunk(platforms, SCHEDULER_CONFIG.BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} platforms)`);

    const results = await Promise.allSettled(
      batch.map(platform =>
        withTimeout(
          refreshSinglePlatform(platform, platformType),
          SCHEDULER_CONFIG.PLATFORM_TIMEOUT_MS,
          `${platformType} ${platform._id}`,
        ),
      ),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value === 'skipped') skipped++;
        else refreshed++;
      } else {
        failed++;
      }
    }

    if (i < batches.length - 1) {
      await sleep(SCHEDULER_CONFIG.BATCH_DELAY_MS);
    }
  }

  const summary = `${platformType}: ${refreshed} refreshed, ${skipped} skipped (fresh), ${failed} failed`;
  logger.info(`${platformType} refresh complete: ${summary}`);
  return summary;
}

/**
 * Refresh analytics, audience, and content for a single platform.
 * Returns 'skipped' if data is still fresh, 'refreshed' otherwise.
 */
async function refreshSinglePlatform(
  platform: Platform,
  platformType: PlatformType,
): Promise<'refreshed' | 'skipped'> {
  const platformId = platform._id.toString();

  // Check if analytics are already fresh (< 24h old)
  const existingAnalytics = await platformAnalyticsModel.findOne({
    platform_id: platform._id,
    type: platformType,
  }).lean();

  if (existingAnalytics?.updated_at && !isAnalyticsStale(existingAnalytics.updated_at)) {
    return 'skipped';
  }

  // Validate credential
  const credential: PlatformCredentials = await platformCredentialModel.findOne({
    _id: platform.platform_credential_id,
  }).lean();

  if (!credential) {
    logger.warn(`No credential found for ${platformType} platform ${platformId}`);
    return 'skipped';
  }

  const now = Math.floor(Date.now() / 1000);
  if (credential.access_token_expiries && credential.access_token_expiries < now) {
    logger.warn(`Token expired for ${platformType} platform ${platformId}, skipping`);
    return 'skipped';
  }

  // Run analytics, audience, and content refresh in parallel
  await Promise.allSettled([
    refreshAnalytics(platform, credential, platformType).catch(err => {
      logger.error(`Analytics refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
    }),
    refreshAudience(platformId, platformType).catch(err => {
      logger.error(`Audience refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
    }),
    refreshContent(platform, credential, platformType).catch(err => {
      logger.error(`Content refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
    }),
  ]);

  return 'refreshed';
}

// --- Analytics Refresh ---

async function refreshAnalytics(
  platform: Platform,
  credential: PlatformCredentials,
  platformType: PlatformType,
): Promise<void> {
  const platformService = new PlatformService();
  const platformId = platform._id.toString();

  switch (platformType) {
    case PlatformType.INSTAGRAM:
      // getPlatformInstagram triggers background refresh internally
      await platformService.getPlatformInstagram(platformId);
      break;
    case PlatformType.YOUTUBE:
      await platformService.getPlatformYotube(platformId);
      break;
    case PlatformType.FACEBOOK:
      await platformService.getPlatformFacebook(platformId);
      break;
    case PlatformType.TIKTOK:
      await platformService.getPlatformTiktok(platformId);
      break;
  }
}

// --- Audience Refresh ---

async function refreshAudience(
  platformId: string,
  platformType: PlatformType,
): Promise<void> {
  const audienceService = new PlatformAudienceService();

  switch (platformType) {
    case PlatformType.INSTAGRAM:
      await audienceService.getAudienceInstagram(platformId, 'lifetime');
      break;
    case PlatformType.YOUTUBE:
      await audienceService.getAudienceYoutube(platformId, 'lifetime');
      break;
    case PlatformType.FACEBOOK:
      await audienceService.getAudienceFacebook(platformId, 'lifetime');
      break;
    case PlatformType.TIKTOK:
      await audienceService.getAudienceTiktok(platformId, 'lifetime');
      break;
  }
}

// --- Content Refresh ---

async function refreshContent(
  platform: Platform,
  credential: PlatformCredentials,
  platformType: PlatformType,
): Promise<void> {
  switch (platformType) {
    case PlatformType.INSTAGRAM: {
      const igService = new InstagramService(DUMMY_REQ, DUMMY_RES, DUMMY_USER, PlatformType.INSTAGRAM);
      await igService.fetchPost(platform, credential.access_token);
      break;
    }
    case PlatformType.YOUTUBE: {
      const googleService = new GoogleService(DUMMY_REQ, DUMMY_RES, DUMMY_USER, PlatformType.YOUTUBE);
      const accessToken = await googleService.getAccessToken(credential, platform);
      await googleService.getRecentVideos(platform, accessToken, 25);
      break;
    }
    case PlatformType.FACEBOOK: {
      const fbService = new FacebookService(DUMMY_REQ, DUMMY_RES, DUMMY_USER, PlatformType.FACEBOOK);
      await fbService.fetchRecentAndTopPosts(
        platform.platform_unique_id,
        credential.access_token,
      );
      break;
    }
    case PlatformType.TIKTOK: {
      // TikTok content is fetched during analytics refresh (video list call)
      break;
    }
  }
}

