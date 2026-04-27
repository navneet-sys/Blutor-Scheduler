import AnalyticsService from '@services/analytics.service';
import dailyAdminSnapshotModel from '@models/dailyAdminSnapshot.model';
import { formatDateIST, istDayStart } from '@utils/timezone';
import { logger } from '../lib/logger';

/**
 * Runs at 00:15 IST. Same 6-hour lookback as DAU to avoid the midnight
 * boundary race where node-cron fires a few ms early and yesterdayIST()
 * returns 2-days-ago.
 */
export async function runDailyOverviewSnapshot(): Promise<string> {
  const service = new AnalyticsService();

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const yesterdayStr = formatDateIST(sixHoursAgo);
  const yesterday = istDayStart(yesterdayStr);

  const [overview, alertsData] = await Promise.all([
    service.getDailyOverview(),
    service.getAlerts(),
  ]);

  await dailyAdminSnapshotModel.findOneAndUpdate(
    { date: yesterday },
    {
      date: yesterday,
      yesterday: overview.yesterday,
      dayBefore: overview.dayBefore,
      weekAvg: overview.weekAvg,
      alerts: { health: alertsData.health, items: alertsData.alerts },
      calculated_at: new Date(),
    },
    { upsert: true, new: true },
  );

  const summary = `Admin snapshot for ${yesterdayStr}: joined=${overview.yesterday.joined}, dau=${overview.yesterday.dau}, health=${alertsData.health}`;
  logger.info(summary);
  return summary;
}
