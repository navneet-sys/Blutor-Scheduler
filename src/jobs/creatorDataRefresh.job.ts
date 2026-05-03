import platformModel from '@models/platforms.model';
import platformCredentialModel from '@models/platformCredentials.model';
import platformAnalyticsModel from '@/models/platformAnalytics.model';
import PlatformBioLinkHistoryModel from '@models/platformBioLinkHistory.model';
import superShareModel from '@models/supershare.model';
import { Platform, PlatformCredentials, PlatformType } from '@interfaces/platforms.interface';
import { PlatformUserDto } from '@dtos/platforms.dto';
import { isAnalyticsStale } from '@constants/metrics';
import { logger } from '../lib/logger';
import { chunk, sleep, withTimeout } from '../lib/utils';
import { sendTelegramMessage } from '../lib/telegram';
import { SCHEDULER_CONFIG } from '../config';
import axios from 'axios';
import mongoose from 'mongoose';

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
  const platforms = await platformModel
    .find({ type: platformType, platform_credential_id: { $ne: null } })
    .lean();

  if (platforms.length === 0) {
    logger.info(`No ${platformType} platforms found, skipping refresh`);
    return `${platformType}: 0 platforms found`;
  }

  logger.info(`Starting ${platformType} creator data refresh for ${platforms.length} platforms`);
  await sendTelegramMessage(
    `creator-refresh-${platformType}: started — ${platforms.length} platforms after filter`,
  ).catch(() => {});

  // Bulk-load credentials and analytics into maps to avoid per-platform DB lookups
  const credIds = platforms.map(p => p.platform_credential_id).filter(Boolean);
  const credentials = await platformCredentialModel.find({ _id: { $in: credIds } }).lean();
  const credByPlatformCredId = new Map(credentials.map(c => [String(c._id), c]));

  const platformIds = platforms.map(p => p._id);
  const allAnalytics = await platformAnalyticsModel
    .find({ platform_id: { $in: platformIds }, type: platformType })
    .lean();
  const analyticsByPlatformId = new Map(allAnalytics.map(a => [String(a.platform_id), a]));

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  const batches = chunk(platforms, SCHEDULER_CONFIG.BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (i % 20 === 0) {
      logger.info(`${platformType} progress: batch ${i + 1}/${batches.length}, refreshed=${refreshed}, skipped=${skipped}, failed=${failed}`);
    }

    if (i > 0 && i % 50 === 0) {
      await sendTelegramMessage(
        `creator-refresh-${platformType}: batch ${i}/${batches.length} (refreshed=${refreshed}, skipped=${skipped}, failed=${failed})`,
      ).catch(() => {});
    }

    const results = await Promise.allSettled(
      batch.map(platform =>
        withTimeout(
          refreshSinglePlatform(platform, platformType, credByPlatformCredId, analyticsByPlatformId),
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
 * Refresh analytics, audience, content, and bio-link for a single platform.
 * Bio link always refreshes (cheap single GET). Analytics/audience/content
 * only refresh when stale (> 24h). Credentials and analytics are pre-loaded
 * via bulk maps to avoid per-platform DB lookups.
 */
async function refreshSinglePlatform(
  platform: Platform,
  platformType: PlatformType,
  credByPlatformCredId: Map<string, PlatformCredentials>,
  analyticsByPlatformId: Map<string, any>,
): Promise<'refreshed' | 'skipped'> {
  const platformId = platform._id.toString();

  const credential = credByPlatformCredId.get(String(platform.platform_credential_id));
  if (!credential) {
    logger.warn(`No credential found for ${platformType} platform ${platformId}`);
    return 'skipped';
  }

  const now = Math.floor(Date.now() / 1000);
  if (credential.access_token_expiries && credential.access_token_expiries < now) {
    return 'skipped';
  }

  const existingAnalytics = analyticsByPlatformId.get(platformId);
  const isStale = !existingAnalytics?.updated_at || isAnalyticsStale(existingAnalytics.updated_at);

  const tasks: Promise<any>[] = [
    refreshBioLink(platform, credential, platformType).catch(err => {
      logger.warn(`Bio link refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
    }),
  ];

  if (isStale) {
    tasks.push(
      refreshAnalytics(platform, credential, platformType).catch(err => {
        logger.error(`Analytics refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
      }),
      refreshAudience(platformId, platformType).catch(err => {
        logger.error(`Audience refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
      }),
      refreshContent(platform, credential, platformType).catch(err => {
        logger.error(`Content refresh failed for ${platformType} ${platformId}: ${err?.message || err}`);
      }),
    );
  }

  await Promise.allSettled(tasks);
  return isStale ? 'refreshed' : 'skipped';
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

// --- Bio Link Refresh (Instagram only) ---

async function refreshBioLink(
  platform: Platform,
  credential: PlatformCredentials,
  platformType: PlatformType,
): Promise<void> {
  if (platformType !== PlatformType.INSTAGRAM) return;
  if (!platform.platform_unique_id || !credential?.access_token) return;

  const igId = String(platform.platform_unique_id);

  // Fetch website from IG API
  let website: string | null = null;
  try {
    const url = `https://graph.instagram.com/v23.0/${igId}?fields=website&access_token=${credential.access_token}`;
    const res = await axios.get(url, { timeout: 8000 });
    website = res.data?.website || null;
  } catch (err: any) {
    // Try Business API fallback
    try {
      const fbUrl = `https://graph.facebook.com/v15.0/${igId}?fields=website&access_token=${credential.access_token}`;
      const fbRes = await axios.get(fbUrl, { timeout: 8000 });
      website = fbRes.data?.website || null;
    } catch {
      logger.warn(`Bio link fetch failed for platform ${platform._id}: ${err?.message || err}`);
      return;
    }
  }

  // Compare with stored bio_link
  const storedPlatform: any = await platformModel.findById(platform._id).lean();
  if (storedPlatform?.bio_link === website) return; // No change

  // Persist new bio_link to Platform
  await platformModel.updateOne({ _id: platform._id }, { $set: { bio_link: website } });

  if (!website) return; // Cleared — no history needed

  // URL-match against this account's grows
  const grows = await superShareModel.find({ account_id: platform.account_id, type: 'subscriber' }).lean();

  let matchedGrowId: mongoose.Types.ObjectId | null = null;

  const normalize = (u: string) => {
    try { return new URL(u).hostname.toLowerCase() + new URL(u).pathname.replace(/\/$/, ''); } catch { return u.toLowerCase(); }
  };

  for (const g of grows) {
    if (!g.url) continue;
    // (a) Exact match
    if (g.url === website) { matchedGrowId = g._id; break; }
    // (b) Short-URL pattern /t/<unique_id>
    if (website.includes(`/t/${g.unique_id}`)) { matchedGrowId = g._id; break; }
    // (c) Normalized host+path
    if (normalize(g.url) === normalize(website)) { matchedGrowId = g._id; break; }
  }

  // Insert history row
  await PlatformBioLinkHistoryModel.create({
    platform_id: platform._id,
    account_id: platform.account_id,
    bio_url: website,
    matched_grow_id: matchedGrowId,
    detected_at: new Date(),
  });

  // If auto-matched, also set bio_link_status on the grow
  if (matchedGrowId) {
    // Clear all manual/auto flags first
    await superShareModel.updateMany(
      { account_id: platform.account_id, bio_link_status: { $ne: null } },
      { $set: { bio_link_status: null, bio_link_set_at: null } },
    );
    await superShareModel.updateOne(
      { _id: matchedGrowId },
      { $set: { bio_link_status: 'auto', bio_link_set_at: new Date() } },
    );
    logger.info(`Bio link auto-matched for account ${platform.account_id}: grow ${matchedGrowId}`);
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

