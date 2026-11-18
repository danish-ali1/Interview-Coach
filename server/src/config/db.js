import mongoose from 'mongoose';

export async function connectDb({ uri, autoIndex = true, logger }) {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(uri, {
    autoIndex,
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info('MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export const isDbReady = () => mongoose.connection.readyState === 1;
