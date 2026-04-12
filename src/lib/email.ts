/**
 * Re-use backend Gmail sender so digest emails match transactional mail.
 */
import GoogleEmailService from '@services/googleEmail.service';

let instance: GoogleEmailService | null = null;

export function getGoogleEmailService(): GoogleEmailService {
  if (!instance) {
    instance = new GoogleEmailService();
  }
  return instance;
}
