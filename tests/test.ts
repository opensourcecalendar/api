"use strict";
const MongoClient = require('mongodb').MongoClient;
const MONGODB_URI = process.env.MONGODB_URI; // or Atlas connection string

(async () => {
    let client = null;
    try {
        client = await MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        const db = client.db('osevents');
        const results = await db.collection('events').find().toArray();

        console.log(results);
        client.close();
    } catch (e) {
        console.error('Error happened', e);
        client.close();
    }
})();
