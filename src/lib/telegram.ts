import axios from 'axios';
import { logger } from './logger';

const MAX_MESSAGE_LENGTH = 4000;

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn('Telegram credentials not configured, skipping notification');
    return;
  }

  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n\n... (truncated)'
    : text;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: truncated,
      disable_web_page_preview: true,
    });
  } catch (error: any) {
    logger.error(`Telegram notification failed: ${error.message}`);
  }
}
