* open-source-calendar-api
    * auto deploy (npm run deploy) when pushed to git repo
    * no terraform necessary, all done in serverless + cloudformation

* open-source-calendar-crawler-worker
    * auto deploy to fargate when pushed to git repo
    * listens on SQS queue for message with body { site: string; }
    * loops through all crawlers and runs them
    * each crawler returns an array of results + metadata (stored for machine learning)
    * terraformed to create fargate and instance

* open-source-calendar-crawler-cloudwatch-event
    * sends SQS message to queue with body { site: 'ALL' }
    * terraformed
