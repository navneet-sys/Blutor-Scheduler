import 'dotenv/config';

export const {
  NODE_ENV,
  MONGODB_ATLAS_URI,
  MONGODB_ATLAS_DATABASE,
  MONGODB_ATLAS_USERNAME,
  MONGODB_ATLAS_PASSWORD,
  MONGODB_ATLAS_CLUSTER,
  DB_URL,
  DB_DATABASE,
  LOG_DIR,
} = process.env;

export const SCHEDULER_CONFIG = {
  BATCH_SIZE: 5,
  BATCH_DELAY_MS: 2000,
  LOCK_TTL_HOURS: 4,
  STALE_THRESHOLD_HOURS: 24,
  TIMEZONE: 'Asia/Kolkata',
  PLATFORM_TIMEOUT_MS: 60_000,
} as const;

export const CRON_SCHEDULES = {
  STORY_FETCH: '0 * * * *',                  // every hour
  INSTAGRAM_REFRESH: '0 1 * * *',            // 1 AM IST
  YOUTUBE_REFRESH: '0 2 * * *',              // 2 AM IST
  TIKTOK_REFRESH: '0 3 * * *',               // 3 AM IST
  FACEBOOK_REFRESH: '0 4 * * *',             // 4 AM IST
  TOKEN_REFRESH: '0 */12 * * *',             // every 12 hours
  PERMISSION_CHECK: '0 5 * * *',             // 5 AM IST
  DELIVERABLE_TRACKING: '0 */6 * * *',       // every 6 hours
  DAU_CALCULATION: '0 0 * * *',              // midnight IST
} as const;
