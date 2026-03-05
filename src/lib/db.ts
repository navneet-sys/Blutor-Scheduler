import path from 'path';
import {
  DB_URL,
  DB_DATABASE,
  NODE_ENV,
  MONGODB_ATLAS_URI,
  MONGODB_ATLAS_DATABASE,
  MONGODB_ATLAS_USERNAME,
  MONGODB_ATLAS_PASSWORD,
  MONGODB_ATLAS_CLUSTER,
} from '../config';
import { logger } from './logger';

// Backend models resolve `require('mongoose')` from blutor-backend/node_modules/.
// We must connect that same mongoose instance so imported models share the DB connection.
const backendRoot = path.resolve(__dirname, '../../../blutor-backend');
const mongoose = require(require.resolve('mongoose', { paths: [backendRoot] }));

const buildAtlasUri = (): string | null => {
  if (MONGODB_ATLAS_URI) return MONGODB_ATLAS_URI;
  if (MONGODB_ATLAS_USERNAME && MONGODB_ATLAS_PASSWORD && MONGODB_ATLAS_CLUSTER) {
    return `mongodb+srv://${encodeURIComponent(MONGODB_ATLAS_USERNAME)}:${encodeURIComponent(MONGODB_ATLAS_PASSWORD)}@${MONGODB_ATLAS_CLUSTER}.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
  }
  return null;
};

const getDatabaseConfig = () => {
  const env = NODE_ENV || 'development';

  if (env === 'production' || env === 'development') {
    const atlasUri = buildAtlasUri();
    if (atlasUri) {
      return {
        url: atlasUri,
        options: {
          dbName: MONGODB_ATLAS_DATABASE || DB_DATABASE,
          autoCreate: true,
        },
      };
    }
  }

  return {
    url: `${DB_URL}`,
    options: {
      dbName: DB_DATABASE,
      autoCreate: true,
    },
  };
};

export async function connectDatabase(): Promise<void> {
  const { url, options } = getDatabaseConfig();
  try {
    await mongoose.connect(url, options);
    logger.info(`Database connected successfully (db: ${options.dbName})`);
  } catch (error) {
    logger.error(`Database connection failed: ${error}`);
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Database disconnected');
}
