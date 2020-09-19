import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';

import { MongoClient, Db } from 'mongodb';
import axios from 'axios';

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
    console.error('unhandled error', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: e,
        message: 'unhandled error'
      })
    };
  }
};

export const crawl: ScheduledHandler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;
    console.log('event: ', JSON.stringify(event, null, 2));
    console.log('context: ', JSON.stringify(context, null, 2));

    const body = {
      "start_date": "2020-01-01",
      "end_date": "2020-01-31"
    };

    const response = await axios.post<MercerCountParkResponse>('https://mercercountyparks.org/api/events-by-date/list/', body);
    const db = await connectToDatabase(MONGODB_URI);

    const result = await db.collection('open-source-calendar').insertOne(response.data);
    console.log(`db result ${result}`);
    console.log(response);
  }
  catch (e) {
    console.error('unhandled error', e);
  }
}

export interface MercerCountyParkEvent {
  start_datetime: string;
  location_coordinate: number[],
  title: string;
  description: string;
  note: string;
  end_datetime: string;
  recurring: boolean;
  recurring_days_of_week: { title: string; day_of_week: number; id: number; }[]
}
export interface MercerCountParkResponse {
  events_by_date: { [date: string]: MercerCountyParkEvent[] }
}