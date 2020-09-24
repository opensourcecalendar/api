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
