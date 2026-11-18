/**
 * Creates/updates all MongoDB indexes declared on the models (unique email, TTL on refresh tokens...).
 * Useful when MONGO_AUTO_INDEX=false in production:  npm run db:indexes
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../models/User.js';
import '../models/RefreshToken.js';
import '../models/Resume.js';
import '../models/ResumeChunk.js';
import '../models/InterviewSession.js';

dotenv.config({ quiet: true });

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
for (const model of Object.values(mongoose.models)) {
  await model.syncIndexes();
  console.log(`synced indexes: ${model.modelName}`);
}
await mongoose.disconnect();
