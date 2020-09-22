import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';

import { MongoClient, Db, ObjectId } from 'mongodb';
import axios from 'axios';
import { addDays, format, parseISO } from 'date-fns';
import { createHash } from 'crypto';

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
  cachedDb = client.db('osevents');
  return cachedDb;
}

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 100;
const LIMIT_MIN = 1;

export const list: APIGatewayProxyHandler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    let qs = event.queryStringParameters || {};

    let limit = +(qs.limit || LIMIT_DEFAULT);
    limit = Math.min(Math.max(LIMIT_MIN, limit), LIMIT_MAX);

    let next = null;

    try {
      next = qs.next ? new ObjectId(qs.next) : null;
    }
    catch (e) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true
        },
        body: JSON.stringify({ message: 'Invalid next token' })
      };
    }

    const db = await connectToDatabase(MONGODB_URI);
    const findQuery = next ? { _id: { $lt: new ObjectId(next) } } : {};

    const results: { _id: any, hash: string, startDate: Date, endDate: Date }[] = await db.collection('events')
      .find(findQuery)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();

    const nextNext = results.length > 0 ? results[results.length - 1]._id : null;

    // remove _id property
    const items = results.map(({ _id, hash, ...keepAttrs }) => keepAttrs)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Expose-Headers': 'X-Pagination-Next',
        'X-Pagination-Next': nextNext,
      },
      body: JSON.stringify(items, null, 2),
    };

  } catch (e) {
    console.error('unhandled error', e);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
      },
      body: JSON.stringify({
        error: e,
        message: 'unhandled error'
      })
    };
  }
};

export const crawl: ScheduledHandler = async (_event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const crawlers: ICrawler[] = [new MercerCountyParkCrawler()];
    const crawlPromises = crawlers.map(crawler => crawler.crawl()).flat();
    const items = (await Promise.all(crawlPromises)).flat();

    console.log(`=> Saving ${items.length} items`);
    const db = await connectToDatabase(MONGODB_URI);
    const collection = db.collection('events');

    try {
      await collection.insertMany(items, { ordered: false });
    } catch (e) {
      // duplicate index broke - throw error
      if (e.toString().indexOf('E11000') < 0) throw e;
    }
  }
  catch (e) {
    console.error('=> unhandled error', e);
  }
}

export interface ICrawler {
  crawl(): Promise<OSEventsEvent[]>;
}

export class MercerCountyParkCrawler implements ICrawler {
  async crawl() {
    const today = new Date();
    const body = {
      "start_date": format(today, 'yyyy-MM-dd'),
      "end_date": format(addDays(today, 30), 'yyyy-MM-dd')
    };

    const url = 'https://mercercountyparks.org/api/events-by-date/list/';

    const response = await axios.post<MercerCountParkResponse>(url, body);

    const items = Object.keys(response.data.results.events_by_date)
      .map(c => response.data.results.events_by_date[c].map(obj => this.map(obj)));

    const flattedItems = items.flat();
    return flattedItems;
  }

  private map(obj: MercerCountyParkEvent): OSEventsEvent {
    let item: OSEventsEvent = {
      startDate: parseISO(obj.start_datetime),
      endDate: parseISO(obj.end_datetime),
      title: obj.title,
      description: obj.description,
      eventSchedule: null,
      extra: { note: obj.note },
      image: {
        url: 'https://mercercountyparks.org' + obj.detail_image.url,
        height: obj.detail_image.height,
        width: obj.detail_image.width
      },
      location: 'Mercer County Park, NJ',
      locationCoord: obj.location_coordinate
    };

    item.hash = createHash('md5').update(JSON.stringify(item)).digest('hex');

    return item;
  }
}

export interface OSEventsEvent {
  startDate: Date;
  endDate: Date;
  title: string;
  description: string;
  eventSchedule: any;
  extra: { [key: string]: any };
  image: { url: string; width: number; height: number; };
  location: string;
  locationCoord: number[];
  hash?: string;
}

export interface MercerCountyParkEvent {
  start_datetime: string;
  location_coordinate: number[],
  title: string;
  description: string;
  note: string;
  end_datetime: string;
  recurring: boolean;
  recurring_days_of_week: { title: string; day_of_week: number; id: number; }[];
  detail_image: {
    url: string;
    width: number;
    height: number;
  }
}
export interface MercerCountParkResponse {
  results: {
    events_by_date: {
      [date: string]: MercerCountyParkEvent[]
    }
  };
}