import AWS from "aws-sdk";
import { createHash } from "crypto";
import fetch from "node-fetch";

import { connectToDatabase } from "../db";
import { OSEventsEvent } from "../models";
import { MercerCountyParkCrawler } from "./mercercountypark";
import { NewHopeWineryCrawler } from "./newhopewinery";

const s3 = new AWS.S3();

// cache of original url => promsie of what the new url will be
const imagecache: { [originalUrl: string]: Promise<string> } = {};

export class Crawler {
  async crawl(crawlerName?: string) {
    const crawlers = this.getCrawlers(crawlerName);
    if (crawlers.length === 0) {
      console.log(`=> No crawlers, ending early.`);
      return;
    }

    let items = (await Promise.all(crawlers.map(crawler => crawler.crawl()).flat())).flat();
    items = (await Promise.all(items.filter((_item, index) => index == 5 || index == 6).map(item => this.addImageUrlToItem(item))));

    console.log(`=> Saving ${items.length} items`);
    const db = await connectToDatabase();

    const collection = db.collection<OSEventsEvent>('events');

    try {
      await collection.insertMany(items, { ordered: false });
      // console.log('=> insertManyResult', JSON.stringify(insertManyResult, null, 2));
    } catch (e) {
      // console.log('=> insertManyResultException', JSON.stringify(e, null, 2));
      // duplicate index broke - throw error
      if (e.toString().indexOf('E11000') < 0) throw e;
    }
  }

  getCrawlers(crawlerName: string) {
    const crawlers: ICrawler[] = [];

    if (!crawlerName || crawlerName === 'all') {
      crawlers.push(new NewHopeWineryCrawler());
      crawlers.push(new MercerCountyParkCrawler());
    } else if (crawlerName === 'mercercountypark') {
      crawlers.push(new MercerCountyParkCrawler());
    } else if (crawlerName === 'newhopewinery') {
      crawlers.push(new NewHopeWineryCrawler());
    }

    return crawlers;
  }

  private async addImageUrlToItem(event: OSEventsEvent): Promise<OSEventsEvent> {
    const url = await this.uploadImageToS3(event);

    return {
      ...event,
      image: {
        ...event.image,
        url: url
      }
    };
  }

  private async uploadImageToS3Inner(event: OSEventsEvent) {
    const fileName = event.image.url.split('/').pop().split('#')[0].split('?')[0];

    const response = await fetch(event.image.url);
    if (!response.ok) return Promise.reject(new Error(`Failed to fetch ${response.url}: ${response.status} ${response.statusText}`));

    const buffer = await response.buffer();

    const hash = createHash('md5').update(buffer).digest('hex');

    const key = `${event.crawlerName}/${hash}_${fileName}`;
    const bucket = process.env.S3_IMAGE_BUCKET;

    console.log(`=> uploading image to bucket: ${bucket}/${key}`);

    const resp = await s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: buffer,
    }).promise();

    console.log('s3 put response', JSON.stringify(resp, null, 2));

    return `https://images.osevents.io/${key}`;
  }

  private async uploadImageToS3(event: OSEventsEvent): Promise<string> {
    if (!event || !event.image || !event.image.url) {
      console.log(`=> No image for ${JSON.stringify(event)}`);
      return null;
    }

    if (event.image.url in imagecache) {
      console.log(`=> already have downloaded ${event.image.url}. Won't download again.`);
    } else {
      imagecache[event.image.url] = this.uploadImageToS3Inner(event);
    }

    return imagecache[event.image.url];
  }
}

export interface ICrawler {
  crawlerName: string;
  crawl(): Promise<OSEventsEvent[]>;
}

export interface BulkWriteError {
  name: string;
  driver: boolean;
  code: number;
  result: {
    ok: boolean;
    insertedIds: [{ _id: string; index: number; }];
    writeErrors: {
      code: number;
      op: {
        _id: string;
      };
    }[];
  };
}