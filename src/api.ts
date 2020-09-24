import { APIGatewayProxyHandler } from "aws-lambda";
import { startOfDay } from "date-fns";
import { WithId } from "mongodb";
import { Crawler } from "./crawlers/crawler";
import { connectToDatabase } from "./db";
import { OSEventsEvent } from "./models";

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;
const LIMIT_MIN = 1;

export const list: APIGatewayProxyHandler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const filter = getFilter(event.queryStringParameters);
    const limit = getLimit(event.queryStringParameters);
    const sort = { startDate: 1, _id: 1 };

    const db = await connectToDatabase();

    // pagination based on this blog entry - https://engineering.mixmax.com/blog/api-paging-built-the-right-way/
    const results = await db.collection<WithId<OSEventsEvent>>('events')
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

export const crawl: APIGatewayProxyHandler = async (event, context) =>{
  try {
    context.callbackWaitsForEmptyEventLoop = false;

    const qs = event.queryStringParameters || {};
    const crawlerName = (qs.crawler || 'all').toLowerCase();
    const crawler = new Crawler();
    await crawler.crawl(crawlerName);

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
    id = new Object(nextId);
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

function getNext(results: WithId<OSEventsEvent>[]) {
  const lastItem = results.length > 0 ? results[results.length - 1] : null;

  if (lastItem == null) return null;
  return `${lastItem.startDate.getTime()}_${lastItem._id}`;
}

