import moment from 'moment-timezone';
import notificationModel from '@models/notification.model';
import accountModel from '@models/accounts.model';
import { EmailTemplates } from '@interfaces/emails.interface';
import { NotificationType } from '@interfaces/notification.interface';
import { logger } from '../lib/logger';
import { SCHEDULER_CONFIG } from '../config';
import { getGoogleEmailService } from '../lib/email';

const TZ = 'Asia/Kolkata';

function stripHtml(html: string): string {
  if (!html || html === '-') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FRONTEND = process.env.FRONTEND_URL || 'https://www.blutor.com';

/**
 * Derive a human-readable one-liner for a notification row.
 * Falls back to the stored HTML message when available; otherwise
 * produces copy from `type` + `username` so the digest never shows
 * a bare "Notification" bullet.
 */
function digestLineForRow(r: any): { text: string; link?: string } {
  const plain = stripHtml(r.message);

  const who = r.username ? `@${r.username}` : 'Someone';

  switch (r.type) {
    case NotificationType.Profile_Viewed:
      return { text: plain || `${who} viewed your profile`, link: r.username ? `${FRONTEND}/profile/${r.username}` : undefined };
    case NotificationType.Started_Following:
      return { text: plain || `${who} started following you`, link: `${FRONTEND}/connection/me/followers` };
    case NotificationType.Connection_Request:
      return { text: plain || `${who} sent you a connection request`, link: `${FRONTEND}/connection/me` };
    case NotificationType.Connection_Accepted:
      return { text: plain || `${who} accepted your connection request`, link: r.username ? `${FRONTEND}/profile/${r.username}` : undefined };
    case NotificationType.Connection_Posted:
      return { text: plain || `${who} shared a new post`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : (r.username ? `${FRONTEND}/profile/${r.username}` : undefined) };
    case NotificationType.Comment_Added:
      return { text: plain || `${who} commented on your post`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Comment_Liked:
      return { text: plain || `${who} liked your comment`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Post_Reaction:
      return { text: plain || `${who} liked your post`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Post_Reposted:
      return { text: plain || `${who} reposted your post`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Mention_In_Post:
      return { text: plain || `${who} mentioned you in a post`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Mention_In_Comment:
      return { text: plain || `${who} mentioned you in a comment`, link: r.post_id ? `${FRONTEND}/post/${r.post_id}` : undefined };
    case NotificationType.Ticket_Resolved:
      return { text: plain || 'Your ticket was resolved', link: `${FRONTEND}/settings/tickets` };
    case NotificationType.Message_Received:
      return {
        text: plain || `${who} sent you a message`,
        link: r.conversation_id ? `${FRONTEND}/messages?conversation=${encodeURIComponent(r.conversation_id)}` : `${FRONTEND}/messages`,
      };
    case NotificationType.MESSAGE:
      if (r.project_id) {
        return { text: plain || 'Collaboration update', link: `${FRONTEND}/p/${r.project_id}` };
      }
      return { text: plain || 'You have a new notification', link: `${FRONTEND}/notifications` };
    default:
      return { text: plain || 'You have a new notification', link: `${FRONTEND}/notifications` };
  }
}

function buildSections(rows: any[]): { html: string; includedIds: Set<string> } {
  const sections: string[] = [];
  const includedIds = new Set<string>();

  const mark = (arr: any[]) => {
    for (const r of arr) includedIds.add(String(r._id));
  };

  const collab = rows.filter(
    r =>
      r.type === NotificationType.MESSAGE &&
      r.project_id &&
      /applied to your project/i.test(r.message || ''),
  );
  const shortlisted = rows.filter(
    r =>
      r.type === NotificationType.MESSAGE &&
      r.project_id &&
      /shortlisted/i.test(r.message || ''),
  );
  const rejected = rows.filter(
    r =>
      r.type === NotificationType.MESSAGE &&
      r.project_id &&
      /not selected/i.test(r.message || ''),
  );
  const messageRows = rows.filter(r => r.type === NotificationType.Message_Received);
  const connections = rows.filter(r => r.type === NotificationType.Connection_Request);
  const tickets = rows.filter(r => r.type === NotificationType.Ticket_Resolved);

  if (collab.length) {
    mark(collab);
    let html = '<h3 style="color:#333;font-size:16px;">Collaborations</h3><ul style="padding-left:18px;">';
    for (const r of collab) {
      const text = stripHtml(r.message) || 'New applicant activity';
      const link = `${FRONTEND}/collaborations/${r.project_id}/applicants`;
      html += `<li style="margin:8px 0;">${text} - <a href="${link}">View applicants</a></li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  if (shortlisted.length) {
    mark(shortlisted);
    let html = '<h3 style="color:#333;font-size:16px;">Your applications</h3><ul style="padding-left:18px;">';
    for (const r of shortlisted) {
      const text = stripHtml(r.message) || 'Shortlist update';
      const link = `${FRONTEND}/p/${r.project_id}`;
      html += `<li style="margin:8px 0;">${text} - <a href="${link}">Open project</a></li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  if (rejected.length) {
    mark(rejected);
    let html = '<h3 style="color:#333;font-size:16px;">Application updates</h3><ul style="padding-left:18px;">';
    for (const r of rejected) {
      const text = stripHtml(r.message) || 'Application update';
      const link = `${FRONTEND}/collaborations`;
      html += `<li style="margin:8px 0;">${text} - <a href="${link}">Browse collaborations</a></li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  if (messageRows.length) {
    mark(messageRows);
    let html = '<h3 style="color:#333;font-size:16px;">Messages</h3><ul style="padding-left:18px;">';
    for (const r of messageRows) {
      const text = stripHtml(r.message) || 'New message';
      const conv = r.conversation_id ? `?conversation=${encodeURIComponent(r.conversation_id)}` : '';
      const link = `${FRONTEND}/messages${conv}`;
      html += `<li style="margin:8px 0;">${text} - <a href="${link}">Open messages</a></li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  if (connections.length) {
    mark(connections);
    const n = connections.length;
    const label = n === 1 ? '1 new connection request' : `${n} new connection requests`;
    const link = `${FRONTEND}/connection/me`;
    sections.push(
      `<h3 style="color:#333;font-size:16px;">Connections</h3><p style="margin:8px 0;">${label} - <a href="${link}">Review requests</a></p>`,
    );
  }

  if (tickets.length) {
    mark(tickets);
    let html = '<h3 style="color:#333;font-size:16px;">Support</h3><ul style="padding-left:18px;">';
    for (const r of tickets) {
      const link = `${FRONTEND}/settings/tickets`;
      html += `<li style="margin:8px 0;">Your ticket was resolved - <a href="${link}">View tickets</a></li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  const rest = rows.filter(r => !includedIds.has(String(r._id)));
  if (rest.length) {
    mark(rest);
    let html = '<h3 style="color:#333;font-size:16px;">Updates</h3><ul style="padding-left:18px;">';
    for (const r of rest) {
      const { text, link } = digestLineForRow(r);
      html += link
        ? `<li style="margin:8px 0;">${text} - <a href="${link}">View</a></li>`
        : `<li style="margin:8px 0;">${text}</li>`;
    }
    html += '</ul>';
    sections.push(html);
  }

  return { html: sections.join(''), includedIds };
}

export async function runNotificationDigest(): Promise<string> {
  logger.info('notification-digest: job started');

  const pending = await notificationModel
    .find({
      is_deleted: false,
      $or: [{ email_sent: false }, { email_sent: { $exists: false } }],
    })
    .lean();

  if (!pending.length) {
    const msg = 'no pending notifications (all digested or none queued)';
    logger.info(`notification-digest: ${msg}`);
    return msg;
  }

  const byAccount = new Map<string, any[]>();
  for (const n of pending) {
    const id = String(n.account_id);
    if (!byAccount.has(id)) byAccount.set(id, []);
    byAccount.get(id)!.push(n);
  }

  const date = moment.tz(TZ).format('MMM D, YYYY');
  let batch = 0;
  let emailsSent = 0;
  let skippedNoEmail = 0;
  let skippedEmptySections = 0;
  let failedAccounts = 0;

  let emailService: ReturnType<typeof getGoogleEmailService> | null = null;

  for (const [accountId, rows] of byAccount) {
    try {
      if (batch > 0 && batch % SCHEDULER_CONFIG.BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, SCHEDULER_CONFIG.BATCH_DELAY_MS));
      }

      const account: any = await accountModel.findById(accountId).lean();
      if (!account?.email || String(account.email).endsWith('@blutor.internal')) {
        skippedNoEmail++;
        batch++;
        continue;
      }

      const { html: sectionsHtml, includedIds } = buildSections(rows);
      if (!sectionsHtml.trim()) {
        skippedEmptySections++;
        batch++;
        continue;
      }

      if (!emailService) {
        emailService = getGoogleEmailService();
      }

      await emailService.sendMailWithTemplate(EmailTemplates.NOTIFICATION_DAILY_DIGEST, account.email, {
        date,
        sections: sectionsHtml,
        notificationsUrl: `${FRONTEND}/notifications`,
      });

      const ids = rows.filter((r: any) => includedIds.has(String(r._id))).map((r: any) => r._id);
      await notificationModel.updateMany({ _id: { $in: ids } }, { $set: { email_sent: true } });

      emailsSent++;
      logger.info(`notification-digest: sent to ${account.email} (${rows.length} items)`);
    } catch (e: any) {
      failedAccounts++;
      logger.error(`notification-digest: failed for account ${accountId}: ${e?.message || e}`);
    }
    batch++;
  }

  const summary = [
    `pending_notifs=${pending.length}`,
    `accounts=${byAccount.size}`,
    `emails_sent=${emailsSent}`,
    `skipped_no_email=${skippedNoEmail}`,
    `skipped_empty_sections=${skippedEmptySections}`,
    `failed_accounts=${failedAccounts}`,
  ].join(', ');

  logger.info(`notification-digest: job finished (${summary})`);
  return summary;
}
