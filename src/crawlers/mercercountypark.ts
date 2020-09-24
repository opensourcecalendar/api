import { createHash } from "crypto";
import axios from 'axios';
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';

import { OSEventsEvent } from "../models";
import { ICrawler } from "./crawler";

export class MercerCountyParkCrawler implements ICrawler {
  crawlerName = 'newhopewinery';

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

    const response = await axios.post<MercerCountyParkResponse>(url, body);

    const items = Object.keys(response.data.results.events_by_date)
      .map(c => response.data.results.events_by_date[c].map(obj => this.map(obj)))
      .flat();

    return items;
  }

  private map(obj: MercerCountyParkEvent): OSEventsEvent {
    const item: OSEventsEvent = {
      crawlerName: this.crawlerName,
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
export interface MercerCountyParkResponse {
  results: {
    events_by_date: {
      [date: string]: MercerCountyParkEvent[]
    }
  };
}
