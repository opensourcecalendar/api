import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) console.error('MONGODB_URI NOT SET');

let cachedDb: Db = null;

export async function connectToDatabase() {
  if (cachedDb) {
    console.log('=> using cached database instance');
    return cachedDb;
  }

  console.log(`=> connect to database with uri ${MONGODB_URI}`);
  const client = await MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true, useNewUrlParser: true });
  cachedDb = client.db('osevents');
  return cachedDb;
}
