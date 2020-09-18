"use strict";

const MongoClient = require('mongodb').MongoClient;
const MONGODB_URI = process.env.MONGODB_URI;

let cachedDb = null;

async function connectToDatabase(uri) {
    if (cachedDb) {
        console.log('=> using cached database instance');
        return cachedDb;
    }

    console.log('=> connect to database with uri ' + uri);
    const client = await MongoClient.connect(uri, {useUnifiedTopology: true, useNewUrlParser: true});
    cachedDb = client.db('open-source-calendar');
    return cachedDb;
}

module.exports.list = async (event, context) => {
    try {
        context.callbackWaitsForEmptyEventLoop = false;
        console.log('event: ', JSON.stringify(event, null, 2));
        console.log('context: ', JSON.stringify(context, null, 2));

        const db = await connectToDatabase(MONGODB_URI);
        const results = await db.collection('open-source-calendar').find({}).toArray();
        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };

    } catch (e) {
        console.log('error unhandled occured', e);
        return e;
    }
};

