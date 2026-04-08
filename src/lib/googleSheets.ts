import { google, sheets_v4 } from 'googleapis';
import { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY_FOR_MAIL } from '../config';
import { logger } from './logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_FOR_MAIL) {
    throw new Error('GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY_FOR_MAIL must be set');
  }

  const privateKey = GOOGLE_PRIVATE_KEY_FOR_MAIL.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: SCOPES,
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Create a new tab in a spreadsheet. If a tab with the same title already
 * exists, return its sheetId without creating a duplicate.
 */
export async function addSheetTab(spreadsheetId: string, title: string): Promise<number> {
  const sheets = getSheetsClient();

  // Check if the tab already exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const existing = meta.data.sheets?.find(s => s.properties?.title === title);
  if (existing?.properties?.sheetId != null) {
    logger.info(`Sheet tab "${title}" already exists (sheetId=${existing.properties.sheetId})`);
    return existing.properties.sheetId;
  }

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  logger.info(`Created sheet tab "${title}" (sheetId=${sheetId})`);
  return sheetId;
}

/**
 * Write rows (including header) to a named tab starting at A1.
 * Overwrites any existing data in the range.
 */
export async function writeRows(
  spreadsheetId: string,
  tabName: string,
  rows: string[][],
): Promise<number> {
  const sheets = getSheetsClient();

  const range = `'${tabName}'!A1`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  logger.info(`Wrote ${rows.length} rows to "${tabName}"`);
  return rows.length;
}
