import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';

import { MongoClient, Db, ObjectId } from 'mongodb';
import axios from 'axios';
import { addMonths, endOfMonth, format, parseISO, startOfDay, startOfMonth } from 'date-fns';
import { createHash } from 'crypto';
const jsonpClient = require('jsonp-client');

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

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;
const LIMIT_MIN = 1;

export const list: APIGatewayProxyHandler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const filter = getFilter(event.queryStringParameters);
    const limit = getLimit(event.queryStringParameters);
    const sort = { startDate: 1, _id: 1 };

    const db = await connectToDatabase(MONGODB_URI);

    // pagination based on this blog entry - https://engineering.mixmax.com/blog/api-paging-built-the-right-way/
    const results: OSEventsEvent[] = await db.collection('events')
      .find(filter)
      .sort(sort)
      .limit(limit)
      .toArray();

    // remove _id and hash properties
    const items = results.map(({ _id, hash, ...keepAttrs }) => keepAttrs)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Expose-Headers': 'X-Pagination-Next',
        'X-Pagination-Next': getNext(results),
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

function getLimit(queryStringParameters: { [name: string]: string } | null) {
  if (queryStringParameters == null || !queryStringParameters.limit) return LIMIT_DEFAULT;

  let limit = +(queryStringParameters.limit || LIMIT_DEFAULT);
  limit = Math.min(Math.max(LIMIT_MIN, limit), LIMIT_MAX);

  return limit;
}

function getFilter(queryStringParameters: { [name: string]: string } | null) {
  const today = new Date();

  if (queryStringParameters == null || !queryStringParameters.next) return { startDate: { $gt: startOfDay(today) } };

  const [nextStartDate, nextId] = queryStringParameters.next.split('_');
  if (!nextStartDate || !nextId) return { startDate: { $gt: startOfDay(today) } };

  let id = null;
  let date = null;

  try {
    date = new Date(+nextStartDate);
  } catch (e) {
    throw new Error('Bad Start Date ' + nextStartDate)
  }
  try {
    id = new ObjectId(nextId);
  } catch (e) {
    throw new Error('Bad Id ' + nextId)
  }

  const filter = {
    $or: [{
      startDate: { $gt: date }
    }, {
      // If the startDate is an exact match, we need a tiebreaker, so we use the _id field from the cursor.
      startDate: date,
      _id: { $gt: id }
    }]
  };

  return filter;
}

function getNext(results: OSEventsEvent[]) {
  const lastItem = results.length > 0 ? results[results.length - 1] : null;

  if (lastItem == null) return null;
  return `${lastItem.startDate.getTime()}_${lastItem._id}`;
}

export const crawl: ScheduledHandler = async (_event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const crawlers: ICrawler[] = [new NewHopeWineryCrawler()];
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
  } catch (e) {
    console.error('=> unhandled error', e);
  }
};

export interface ICrawler {
  crawl(): Promise<OSEventsEvent[]>;
}

export class MercerCountyParkCrawler implements ICrawler {
  async crawl() {
    const items: OSEventsEvent[] = [];
    const today = new Date();

    for (let i = 0; i < 12; i++) {
      const newItems = await this.getItemsForMonth(addMonths(today, i));
      items.push(...newItems);
    }

    return items;
  }

  private async getItemsForMonth(date: Date) {
    const body = {
      start_date: format(startOfMonth(date), 'yyyy-MM-dd'),
      end_date: format(endOfMonth(date), 'yyyy-MM-dd')
    };

    const url = 'https://mercercountyparks.org/api/events-by-date/list/';

    const response = await axios.post<MercerCountParkResponse>(url, body);

    const items = Object.keys(response.data.results.events_by_date)
      .map(c => response.data.results.events_by_date[c].map(obj => this.map(obj)))
      .flat();

    return items;
  }

  private map(obj: MercerCountyParkEvent): OSEventsEvent {
    const item: OSEventsEvent = {
      startDate: parseISO(obj.start_datetime),
      endDate: parseISO(obj.end_datetime),
      title: obj.title,
      description: obj.description,
      eventSchedule: null,
      extra: { note: obj.note },
      image: {
        url: `https://mercercountyparks.org${obj.detail_image.url}`,
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

export class NewHopeWineryCrawler implements ICrawler {
  async crawl(): Promise<OSEventsEvent[]> {
    const timestamp = new Date().getTime();
    const url = `http://newhopewinery.com/calendar/action~stream/request_format~json/?request_type=jsonp&ai1ec_doing_ajax=true&_=${timestamp}`;

    const data = await this.jsonp<NewHopeWineryResponse>(url);

    const items = Object.keys(data.html.dates)
    .map(date => data.html.dates[date]).map((item) => {
      const date = this.getDate(item.full_month, +item.day, +item.year);
      return item.events.notallday.map(nad => this.map(date, nad));
    }).flat();

    return items;
  }

  private jsonp<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      jsonpClient(url, (err: any, data: T) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  private getDate(monthName: string, date: number, year: number) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const index = months.indexOf(monthName.toLowerCase());

    const month = index >= 0 ? index : 0;
    return new Date(year, month, date);
  }

  private map(startDate: Date, event: NewHopeWineryNotAllDayEvent): OSEventsEvent {
    const item: OSEventsEvent = {
      startDate,
      endDate: null,
      title: event.filtered_title,
      description: '',
      eventSchedule: null,
      extra: { ticketUrl: event.ticket_url, permalink: event.permalink, venue: event.venue },
      image: {
        url: event.avatar_url,
        height: null,
        width: null
      },
      location: event.venue,
      locationCoord: null
    };

    item.hash = createHash('md5').update(JSON.stringify(item)).digest('hex');

    return item;
  }
}

export interface NewHopeWineryNotAllDayEvent {
  filtered_title: string; // SOLD OUT-Raul Malo (Saturday Show) Live at The New Hope Winery
  venue: string;
  ticket_url: string;
  permalink: string; // http://newhopewinery.com/event/raul-malo-2nd-saturday-show-live-at-the-new-hope-winery-2/?instance_id=114
  avatar_url: string; // http://newhopewinery.com/wp-content/uploads/2019/12/Raul-Malo-300x202.jpg
  short_start_time: string; // 8:00 pm
  timespan_short: string; // "Oct 3 @ 8:00 pm – 10:00 pm"
}

export interface NewHopeWineryResponse {
  html: {
    dates: {
      [date: string]: {
        events: {
          allday: {}[];
          notallday: NewHopeWineryNotAllDayEvent[];
        };
        day: string; // 3
        full_month: string; // October
        year: string; // 2020
      }
    }
  };
}

export interface OSEventsEvent {
  _id?: string;
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
  location_coordinate: number[];
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
  };
}
export interface MercerCountParkResponse {
  results: {
    events_by_date: {
      [date: string]: MercerCountyParkEvent[]
    }
  };
}
