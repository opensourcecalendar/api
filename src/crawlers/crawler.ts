import AWS from "aws-sdk";
import { createHash } from "crypto";
import fetch from "node-fetch";

import { connectToDatabase } from "../db";
import { OSEventsEvent } from "../models";
import { MercerCountyParkCrawler } from "./mercercountypark";
import { NewHopeWineryCrawler } from "./newhopewinery";

const s3 = new AWS.S3();

export class Crawler {
  async crawl(crawlerName?: string) {
    const crawlers: ICrawler[] = [];

    if (!crawlerName || crawlerName === 'all') {
      crawlers.push(new NewHopeWineryCrawler());
      crawlers.push(new MercerCountyParkCrawler());
    } else if (crawlerName === 'mercercountypark') {
      crawlers.push(new MercerCountyParkCrawler());
    } else if (crawlerName === 'newhopewinery') {
      crawlers.push(new NewHopeWineryCrawler());
    } else {
      return;
    }

    const crawlPromises = crawlers.map(crawler => crawler.crawl()).flat();
    const items = (await Promise.all(crawlPromises)).flat();

    console.log(`=> Saving ${items.length} items`);
    const db = await connectToDatabase();
    const collection = db.collection<OSEventsEvent>('events');

    try {
      await collection.insertMany(items, { ordered: false });
    } catch (e) {
      // duplicate index broke - throw error
      if (e.toString().indexOf('E11000') < 0) throw e;
    }
  }

  async uploadToS3(event: OSEventsEvent) {
    const fileName = event.image.url.split('/').pop().split('#')[0].split('?')[0];

    const response = await fetch(event.image.url);
    if (!response.ok) return Promise.reject(new Error(`Failed to fetch ${response.url}: ${response.status} ${response.statusText}`));

    const buffer = await response.buffer();

    const hash = createHash('md5').update(buffer).digest('hex');

    await s3.putObject({
      Bucket: process.env.BUCKET,
      Key: `${event.location}/${hash}${fileName}`,
      Body: buffer,
    }).promise();
  }
}

export interface ICrawler {
  crawl(): Promise<OSEventsEvent[]>;
}
