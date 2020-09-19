import { APIGatewayProxyHandler } from 'aws-lambda';

import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) console.error('MONGODB_URI NOT SET');

let cachedDb: Db = null;

async function connectToDatabase(uri: string) {
  if (cachedDb) {
    console.log('=> using cached database instance');
    return cachedDb;
  }

  console.log(`=> connect to database with uri ${uri}`);
  const client = await MongoClient.connect(uri, { useUnifiedTopology: true, useNewUrlParser: true });
  cachedDb = client.db('open-source-calendar');
  return cachedDb;
}

export const list: APIGatewayProxyHandler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;
    console.log('event: ', JSON.stringify(event, null, 2));
    console.log('context: ', JSON.stringify(context, null, 2));

    const db = await connectToDatabase(MONGODB_URI);
    const results = await db.collection('open-source-calendar').find({}).toArray();
    return {
      statusCode: 200,
      body: JSON.stringify(results),
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: e,
        message: 'unhandled error'
      })
    };
  }
};
