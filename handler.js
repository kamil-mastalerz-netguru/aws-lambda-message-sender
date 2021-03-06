const randomBytes = require('crypto').randomBytes;
const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const Messenger = require('./messenger.js');
const formatString = require("string-template")

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
  const templatesParams = {
    RequestItems: {
      'message-templates-table-dev': {
        Keys: [
          {
            'Topic': DEFAULT_TOPIC,
          }
        ],
      },
    }
  };

  const usersQueryParams = {
    TableName: USER_TABLE,
    KeyConditionExpression: "CountryCode = :countryCode",
    ExpressionAttributeValues: {
      ":countryCode": "+48",
    }
  }

  const foundTemplates = await ddb.batchGet(templatesParams).promise();
  const foundUsers = await ddb.query(usersQueryParams).promise();

  // const users = foundTemplates.Responses[USER_TABLE];
  const users = foundUsers.Items;
  const templates = foundTemplates.Responses[TEMPLATES_TABLE];

  giveMeAJoke.getRandomCNJoke((joke) => {
    users.forEach(record => {
      const parsedTemplate = formatString(templates[0].Template, {
        username: record.User,
        joke,
      });
      const params = {
        FunctionName: 'aws-lambda-message-sender-dev-sendText',
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          body: {
            to: record.PhoneNumber,
            message: parsedTemplate
          }
        }),
      };
      lambda.invoke(params, (error, data) => {
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
