import { mongoose } from './db';
import os from 'os';
import { logger } from './logger';

const { Schema } = mongoose;

interface ISchedulerLock {
  _id: string;
  locked_at: Date;
  expires_at: Date;
  locked_by: string;
}

const schedulerLockSchema = new Schema(
  {
    _id: { type: String },
    locked_at: { type: Date, required: true },
    expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    locked_by: { type: String, required: true },
  },
  { timestamps: false },
);

const SchedulerLockModel = mongoose.model('scheduler_lock', schedulerLockSchema);

const IDENTITY = `${os.hostname()}:${process.pid}`;

/**
 * Acquire a distributed lock using MongoDB atomic findOneAndUpdate.
 * Returns the lock name if acquired, null if another process holds it.
 */
export async function acquireLock(lockName: string, ttlHours: number): Promise<string | null> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  try {
    const result = await SchedulerLockModel.findOneAndUpdate(
      {
        _id: lockName,
        $or: [
          { expires_at: { $lt: now } },   // expired lock, safe to take
          { expires_at: { $exists: false } }, // no lock exists
        ],
      },
      {
        $set: {
          locked_at: now,
          expires_at: expiresAt,
          locked_by: IDENTITY,
        },
      },
      { upsert: true, new: true },
    );

    if (result && result.locked_by === IDENTITY) {
      logger.info(`Lock acquired: ${lockName} (expires: ${expiresAt.toISOString()})`);
      return lockName;
    }
    return null;
  } catch (error: any) {
    if (error.code === 11000) {
      logger.info(`Lock busy: ${lockName} (held by another process)`);
      return null;
    }
    logger.error(`Lock acquire error for ${lockName}: ${error.message}`);
    throw error;
  }
}

/**
 * Release a lock. Only releases if we are the current holder.
 */
export async function releaseLock(lockName: string): Promise<void> {
  try {
    await SchedulerLockModel.deleteOne({ _id: lockName, locked_by: IDENTITY });
    logger.info(`Lock released: ${lockName}`);
  } catch (error: any) {
    logger.error(`Lock release error for ${lockName}: ${error.message}`);
  }
}

/**
 * Check if a lock is currently held (by anyone).
 */
export async function isLocked(lockName: string): Promise<boolean> {
  const now = new Date();
  const lock = await SchedulerLockModel.findOne({
    _id: lockName,
    expires_at: { $gt: now },
  });
  return !!lock;
}

export { SchedulerLockModel };
