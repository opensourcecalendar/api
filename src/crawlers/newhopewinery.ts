import { createHash } from "crypto";
const jsonpClient = require('jsonp-client');

import { OSEventsEvent } from "../models";
import { ICrawler } from "./crawler";

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