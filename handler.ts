import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';

import { MongoClient, Db } from 'mongodb';
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

export const crawl: ScheduledHandler = async (_event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const crawlers: ICrawler[] = [new MercerCountyParkCrawler()];

    for (let i = 0; i < crawlers.length; i++) {
      const items = await crawlers[i].crawl();
      console.log(JSON.stringify(items, null, 2));

      const db = await connectToDatabase(MONGODB_URI);

      const bulkWriteItems = items.map(item => {
        return {
          updateOne:
          {
            "filter": { hash: item.hash },
            "update": item,
            "upsert": true,
          }
        };
      });

      const result = await db.collection('events').bulkWrite(bulkWriteItems, { ordered: false });
      console.log(JSON.stringify(result, null, 2));
    }
  }
  catch (e) {
    console.error('unhandled error', e);
  }
}

export interface ICrawler {
  crawl(): Promise<OSEventsEvent[]>;
}

export class MercerCountyParkCrawler implements ICrawler {
  async crawl() {
    const today = new Date();
    const body = {
      "start_date": format(today, 'YYYY-MM-DD'),
      "end_date": format(addDays(today, 30), 'YYYY-MM-DD')
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