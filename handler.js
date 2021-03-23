const randomBytes = require('crypto').randomBytes;
const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const Messenger = require('./messenger.js');

const USER_TABLE = 'users-table-dev';
const TEMPLATES_TABLE = 'message-templates-table-dev';
const DEFAULT_TOPIC = 'default';

const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient();

const lambda = new AWS.Lambda({
  region: "eu-central-1"
});

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const giveMeAJoke = require('give-me-a-joke');
const twilioClient = require('twilio')(twilioAccountSid, twilioAuthToken); // eslint-disable-line

module.exports.sendText = (event, context, callback) => {
  const messenger = new Messenger(twilioClient);

  const response = {
    headers: { 'Access-Control-Allow-Origin': '*' }, // CORS requirement
    statusCode: 200,
    body: JSON.stringify({
      To: event.body.to,
      message: event.body.message,
      RequestTime: new Date().toISOString(),
    })
  };

  Object.assign(event, { from: process.env.TWILIO_PHONE_NUMBER });

  messenger.send(event)
  .then((message) => {
    // text message sent! ✅
    console.log(`message ${message.body}`);
    console.log(`date_created: ${message.date_created}`);
    response.body = JSON.stringify({
      message: 'Text message successfully sent!',
      data: message,
    });
    callback(null, response);
  })
  .catch((err) => {
    console.error(err);
    errorResponse(err.message, context.awsRequestId, callback);
    return new Error(`Error adding user: ${JSON.stringify(err)}`);
  });
};

module.exports.addTemplate = (event, context, callback) => {
  const rideId = toUrlString(randomBytes(16));
  saveTemplate(DEFAULT_TOPIC, rideId, event.body.template)
  .then(() => {
    callback(null, {
      statusCode: 201,
      body: JSON.stringify({
        Topic: DEFAULT_TOPIC,
        RideId: rideId,
        Template: event.body.template
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  })
  .catch((err) => {
    console.error(err);
    errorResponse(err.message, context.awsRequestId, callback);
  })
};

module.exports.addUser = (event, context, callback) => {

  saveUser(event.body.username, event.body.phoneNumber)
  .then(() => {
    callback(null, {
      statusCode: 201,
      body: JSON.stringify({
        Username: event.body.username,
        PhoneNumber: event.body.phoneNumber
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  })
  .catch((err) => {
    console.error(err);
    errorResponse(err.message, context.awsRequestId, callback);
  });
};

module.exports.triggerJokes = async (event, context, callback) => {
  const usersParams = {
    RequestItems: {
      'users-table-dev': {
        Keys: [
          {
            'CountryCode': '+48',
            'PhoneNumber': "+48532390966"
          }
        ],
      },
      'message-templates-table-dev': {
        Keys: [
          {
            'Topic': DEFAULT_TOPIC,
          }
        ],
      },
    }
  };

  const foundRecords = await ddb.batchGet(usersParams).promise();

  const users = foundRecords.Responses[USER_TABLE];
  const templates = foundRecords.Responses[TEMPLATES_TABLE];
  console.log(users);
  console.log(templates)
  // const randomTemplate = queriedTamplates[Math.floor(Math.random() * queriedTamplates.length)]
  const randomTemplate = 'Hello ${username} Here is a joke for Today: ${joke}'
  String.prototype.interpolate = function(params) {
    const names = Object.keys(params);
    const vals = Object.values(params);
    return new Function(...names, `return \`${this}\`;`)(...vals);
  }

  giveMeAJoke.getRandomCNJoke((joke) => {
    users.forEach(record => {
      const result = randomTemplate.interpolate({
        username: record.User,
        joke: joke,
      });

      console.log(result);
      const params = {
        FunctionName: 'aws-lambda-message-sender-dev-sendText',
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          body: {
            to: record.PhoneNumber,
            message: result
          }
        }),
      };
      return lambda.invoke(params, (error, data) => {
        if (error) {
          console.error(JSON.stringify(error));
          return new Error(`Error printing messages: ${JSON.stringify(error)}`);
        } else if (data) {
          console.log(data);
        }
      })
    });
  });
};

function saveUser(username, phoneNumber) {
  const number = phoneUtil.parseAndKeepRawInput(phoneNumber);
  const countryCode = `+${number.getCountryCode()}`;
  return ddb.put({
      TableName: USER_TABLE,
      Item: {
          CountryCode: countryCode,
          User: username,
          PhoneNumber: phoneUtil.format(number, PNF.E164),
          RequestTime: new Date().toISOString(),
      },
  }).promise();
}

function saveTemplate(topic, rideId, template) {
  return ddb.put({
    TableName: TEMPLATES_TABLE,
    Item: {
      Topic: topic,
      RideId: rideId,
      Template: template,
    },
  }).promise();
}

function toUrlString(buffer) {
  return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
}

function errorResponse(errorMessage, awsRequestId, callback) {
  callback(null, {
    statusCode: 500,
    body: JSON.stringify({
      Error: errorMessage,
      Reference: awsRequestId,
    }),
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
