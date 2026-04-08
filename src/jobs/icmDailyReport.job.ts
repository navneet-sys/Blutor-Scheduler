import moment from 'moment-timezone';
import accountModel from '@models/accounts.model';
import platformModel from '@models/platforms.model';
import messageModel from '@models/messages.model';
import connectionModel from '@models/connections.model';
import creatorListModel from '@models/creatorList.model';
import icmCreatorModel from '@models/icmCreator.model';
import { logger } from '../lib/logger';
import { addSheetTab, writeRows } from '../lib/googleSheets';
import { ICM_REPORT_SPREADSHEET_ID, SCHEDULER_CONFIG } from '../config';

const HEADER = ['username', 'instagram_handle_url', 'email', 'sender', 'event', 'meta_data'];

interface ICMRow {
  username: string;
  igUrl: string;
  email: string;
  sender: string;
  event: string;
  metaData: string;
}

/**
 * Build a lookup map: lowercase username -> email from icmcreators + accounts.
 */
async function buildEmailMap(
  icmAccountIds: any[],
  platByAccId: Record<string, any>,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  const icmCreators = await icmCreatorModel
    .find({ email: { $exists: true, $ne: null, $ne: '' } }, { username: 1, email: 1 })
    .lean();
  for (const c of icmCreators) {
    if (c.email && c.username) map[c.username.toLowerCase()] = c.email;
  }

  const accounts = await accountModel
    .find({ _id: { $in: icmAccountIds }, email: { $not: /@blutor\.internal$/ } }, { _id: 1, email: 1 })
    .lean();
  for (const a of accounts) {
    const plat = platByAccId[(a as any)._id.toString()];
    if (plat?.username && a.email) {
      map[plat.username.toLowerCase()] = a.email;
    }
  }

  return map;
}

/**
 * Collect all ICM interaction rows for a given date range.
 */
async function collectRows(startDate: Date, endDate: Date): Promise<ICMRow[]> {
  const icmAccounts = await accountModel.find({ profile_source: 'icm' }, { _id: 1, email: 1 }).lean();
  const icmAccountIds = icmAccounts.map((a: any) => a._id);
  const icmAccountIdSet = new Set(icmAccountIds.map((id: any) => id.toString()));

  const icmPlatforms = await platformModel
    .find({ account_id: { $in: icmAccountIds }, type: 'instagram' }, { _id: 1, account_id: 1, username: 1 })
    .lean();

  const platByAccId: Record<string, any> = {};
  for (const p of icmPlatforms) {
    platByAccId[(p as any).account_id.toString()] = p;
  }

  const emailMap = await buildEmailMap(icmAccountIds, platByAccId);
  const getEmail = (username: string) => emailMap[username?.toLowerCase()] || '';

  const rows: ICMRow[] = [];

  // --- Messages to ICM users ---
  const messages = await messageModel
    .find({
      receiver_id: { $in: icmAccountIds },
      created_at: { $gte: startDate, $lt: endDate },
    })
    .lean();

  const senderAccIds = [...new Set(messages.map((m: any) => m.sender_id).filter(Boolean))];
  const senderPlatforms = await platformModel
    .find({ account_id: { $in: senderAccIds }, type: 'instagram' }, { _id: 1, account_id: 1, username: 1 })
    .lean();
  const senderPlatByAccId: Record<string, any> = {};
  for (const p of senderPlatforms) {
    senderPlatByAccId[(p as any).account_id.toString()] = p;
  }
  const senderAccounts = await accountModel.find({ _id: { $in: senderAccIds } }, { _id: 1, email: 1 }).lean();
  const senderAccById: Record<string, any> = {};
  for (const a of senderAccounts) {
    senderAccById[(a as any)._id.toString()] = a;
  }

  for (const m of messages as any[]) {
    if (!m.receiver_id || !m.sender_id) continue;
    const receiverPlat = platByAccId[m.receiver_id.toString()];
    const senderPlat = senderPlatByAccId[m.sender_id.toString()];
    const senderAcc = senderAccById[m.sender_id.toString()];

    const username = receiverPlat?.username || m.receiver_username || 'unknown';
    const sender = senderPlat?.username || senderAcc?.email?.split('@')[0] || m.sender_username || 'unknown';

    rows.push({
      username,
      igUrl: `https://instagram.com/${username}`,
      email: getEmail(username),
      sender,
      event: 'message',
      metaData: (m.text || '').replace(/\n/g, ' ').replace(/\r/g, ''),
    });
  }

  // --- Creator lists with ICM creators (added to list) ---
  const lists = await creatorListModel
    .find({
      'icm_creators.0': { $exists: true },
      $or: [
        { createdAt: { $gte: startDate, $lt: endDate } },
        { updatedAt: { $gte: startDate, $lt: endDate } },
      ],
    })
    .lean();

  for (const list of lists as any[]) {
    const ownerPlatArr = await platformModel
      .find({ account_id: list.owner_id, type: 'instagram' }, { username: 1 })
      .lean();
    const ownerPlat = ownerPlatArr[0] as any;
    const ownerAccArr = await accountModel.find({ _id: list.owner_id }, { email: 1 }).lean();
    const ownerAcc = ownerAccArr[0] as any;
    const sender = ownerPlat?.username || ownerAcc?.email?.split('@')[0] || 'unknown';

    for (const creator of list.icm_creators || []) {
      const username = creator.username || 'unknown';
      rows.push({
        username,
        igUrl: `https://instagram.com/${username}`,
        email: getEmail(username),
        sender,
        event: 'added to list',
        metaData: list.name || '',
      });
    }
  }

  // --- Connection requests involving ICM users ---
  const connections = await connectionModel
    .find({ created_at: { $gte: startDate, $lt: endDate } })
    .lean();

  if (connections.length > 0) {
    const allPlatIds = connections.flatMap((c: any) => [c.sender_id, c.receiver_id].filter(Boolean));
    const involvedPlats = await platformModel
      .find({ _id: { $in: allPlatIds } }, { _id: 1, account_id: 1, username: 1 })
      .lean();
    const platById: Record<string, any> = {};
    for (const p of involvedPlats) {
      platById[(p as any)._id.toString()] = p;
    }

    for (const c of connections as any[]) {
      if (!c.sender_id || !c.receiver_id) continue;
      const sP = platById[c.sender_id.toString()];
      const rP = platById[c.receiver_id.toString()];
      const sIsICM = sP?.account_id && icmAccountIdSet.has(sP.account_id.toString());
      const rIsICM = rP?.account_id && icmAccountIdSet.has(rP.account_id.toString());

      if (sIsICM || rIsICM) {
        const icmP = rIsICM ? rP : sP;
        const otherP = rIsICM ? sP : rP;
        const username = icmP?.username || 'unknown';
        rows.push({
          username,
          igUrl: `https://instagram.com/${username}`,
          email: getEmail(username),
          sender: otherP?.username || 'unknown',
          event: 'request sent',
          metaData: '',
        });
      }
    }
  }

  return rows;
}

/**
 * Run the ICM daily report for a single date (default: yesterday).
 * Creates a tab named "ICM YYYY-MM-DD" and writes all interactions.
 */
export async function runICMDailyReport(targetDate?: Date): Promise<string> {
  if (!ICM_REPORT_SPREADSHEET_ID) {
    throw new Error('ICM_REPORT_SPREADSHEET_ID env var is not set');
  }

  const tz = SCHEDULER_CONFIG.TIMEZONE;
  const date = targetDate
    ? moment(targetDate).tz(tz).startOf('day')
    : moment().tz(tz).subtract(1, 'day').startOf('day');

  const startDate = date.toDate();
  const endDate = moment(date).add(1, 'day').toDate();
  const dateStr = date.format('YYYY-MM-DD');
  const tabName = `ICM ${dateStr}`;

  logger.info(`ICM daily report: collecting interactions for ${dateStr}`);
  const rows = await collectRows(startDate, endDate);

  if (rows.length === 0) {
    logger.info(`ICM daily report: no interactions for ${dateStr}, skipping tab creation`);
    return `${dateStr}: 0 interactions (no tab created)`;
  }

  const sheetRows = [HEADER, ...rows.map(r => [r.username, r.igUrl, r.email, r.sender, r.event, r.metaData])];

  await addSheetTab(ICM_REPORT_SPREADSHEET_ID, tabName);
  await writeRows(ICM_REPORT_SPREADSHEET_ID, tabName, sheetRows);

  const summary = `${dateStr}: ${rows.length} interactions written to tab "${tabName}"`;
  logger.info(`ICM daily report: ${summary}`);
  return summary;
}

/**
 * Backfill: run the report for every day from startDate through yesterday.
 * Skips days with zero interactions (no empty tabs).
 */
export async function runICMDailyReportBackfill(fromDate?: Date): Promise<string> {
  const tz = SCHEDULER_CONFIG.TIMEZONE;
  const start = fromDate
    ? moment(fromDate).tz(tz).startOf('day')
    : moment('2026-04-01', 'YYYY-MM-DD').tz(tz).startOf('day');
  const yesterday = moment().tz(tz).subtract(1, 'day').startOf('day');

  const results: string[] = [];
  const cursor = moment(start);

  while (cursor.isSameOrBefore(yesterday)) {
    try {
      const result = await runICMDailyReport(cursor.toDate());
      results.push(result);
    } catch (err: any) {
      const dateStr = cursor.format('YYYY-MM-DD');
      logger.error(`ICM backfill failed for ${dateStr}: ${err.message}`);
      results.push(`${dateStr}: FAILED - ${err.message}`);
    }
    cursor.add(1, 'day');
  }

  const summary = `Backfill complete: ${results.length} days processed\n${results.join('\n')}`;
  logger.info(`ICM backfill: ${summary}`);
  return summary;
}
