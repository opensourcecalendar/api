'use strict';

module.exports.list = (event, context, callback) => {
    const response = {
      statusCode: 200,
      body: JSON.stringify([
        {
          eventId: '123',
          startDate: new Date(),
          endDate: new Date(),
          location: '1 North Pole',
          title: 'Christmas'
        }
      ]),
    };
    callback(null, response);
};
