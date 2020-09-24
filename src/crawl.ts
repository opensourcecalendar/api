import { ScheduledHandler } from "aws-lambda";
import { Crawler } from "./crawlers/crawler";

export const crawl: ScheduledHandler = async (_event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;
    const crawler = new Crawler();
    await crawler.crawl();
  } catch (e) {
    console.error('=> unhandled error', e);
  }
};
