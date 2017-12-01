/*-----------------------------------------------------------------------------
A simple echo bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

require('dotenv').config();

const fs = require('fs');
var restify = require('restify');
var builder = require('botbuilder');
const ticketsApi = require('./ticketsApi');
const ticketSubmissionUrl = process.env.TICKET_SUBMISSION_URL || `http://localhost:${process.env.PORT }`;

const restifyBodyParser = require('restify-plugins').bodyParser;
const restifyCreateJsonClient = require('restify-clients').createJsonClient;


// Setup Restify Server
var server = restify.createServer();
  
server.use(restifyBodyParser());

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
});

// Listen for messages from users 
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});

server.post('/api/tickets', ticketsApi);

server.post('/api/messages', connector.listen());

/*----------------------------------------------------------------------------------------
* Bot Storage: This is a great spot to register the private state storage for your bot. 
* We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
* For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
* ---------------------------------------------------------------------------------------- */

// Create your bot with a function to receive messages from the user
// XXX var bot = new builder.UniversalBot(connector);

var bot = new builder.UniversalBot(connector, (session) => {
    session.endDialog(`I'm sorry, I did not understand '${session.message.text}'.\nType 'help' to know more about me :)`);
});

// Make sure you add code to validate these fields
var luisAppId = process.env.LuisAppId;
var luisAPIKey = process.env.LuisAPIKey;
var luisAPIHostName = process.env.LuisAPIHostName || 'westus.api.cognitive.microsoft.com';

const LuisModelUrl = `https://westus.api.cognitive.microsoft.com/luis/v2.0/apps/${luisAppId}?subscription-key=${luisAPIKey}&verbose=true&timezoneOffset=0&q=`;

// Main dialog with LUIS
var recognizer = new builder.LuisRecognizer(LuisModelUrl).onEnabled(function (context, callback) {
          var enabled = context.dialogStack().length === 0;
          callback(null, enabled);
      });
bot.recognizer(recognizer);

// var intents = new builder.IntentDialog({ recognizers: [recognizer] })
/*
.matches('<yourIntent>')... See details at http://docs.botframework.com/builder/node/guides/understanding-natural-language/
.onDefault((session) => {
    session.send('Yo man, I did not understand \'%s\'.', session.message.text);
});

bot.dialog('/', intents);    
*/

bot.dialog('Help',
    (session, args, next) => {
        session.endDialog(`I'm the help desk bot and I can help you create a ticket.\n` +
            `You can tell me things like _I need to reset my password_ or _I cannot print_.`);
    }
).triggerAction({
    matches: 'Help'
});

bot.dialog('SubmitTicket', [
  (session, args, next) => {
      var category = builder.EntityRecognizer.findEntity(args.intent.entities, 'category');
      var severity = builder.EntityRecognizer.findEntity(args.intent.entities, 'severity');

      if (category && category.resolution.values.length > 0) {
          session.dialogData.category = category.resolution.values[0];
      }

      if (severity && severity.resolution.values.length > 0) {
          session.dialogData.severity = severity.resolution.values[0];
      }

      session.dialogData.description = session.message.text;

      if (!session.dialogData.severity) {
          var choices = ['high', 'normal', 'low'];
          builder.Prompts.choice(session, 'Which is the severity of this problem?', choices, { listStyle: builder.ListStyle.button });
      } else {
          next();
      }
  },
  (session, result, next) => {
      if (!session.dialogData.severity) {
          session.dialogData.severity = result.response.entity;
      }

      if (!session.dialogData.category) {
          builder.Prompts.text(session, 'Which would be the category for this ticket (software, hardware, network, and so on)?');
      } else {
          next();
      }
  },
  (session, result, next) => {
      if (!session.dialogData.category) {
          session.dialogData.category = result.response;
      }

      var message = `Great! I'm going to create a "${session.dialogData.severity}" severity ticket in the "${session.dialogData.category}" category. ` +
                    `The description I will use is "${session.dialogData.description}". Can you please confirm that this information is correct?`;

      builder.Prompts.confirm(session, message, { listStyle: builder.ListStyle.button });
  },
  (session, result, next) => {
      if (result.response) {
          var data = {
              category: session.dialogData.category,
              severity: session.dialogData.severity,
              description: session.dialogData.description,
          }

          const client = restifyCreateJsonClient({ url: ticketSubmissionUrl });

          client.post('/api/tickets', data, (err, request, response, ticketId) => {
              if (err || ticketId == -1) {
                  session.send('Something went wrong while I was saving your ticket. Please try again later.')
              } else {
                session.send(new builder.Message(session).addAttachment({
                    contentType: "application/vnd.microsoft.card.adaptive",
                    content: createCard(ticketId, data)
                }));
              }

              session.endDialog();
          });
      } else {
          session.endDialog('Ok. The ticket was not created. You can start again if you want.');
      }
  }
])
.triggerAction({
  matches: 'SubmitTicket'
});

const createCard = (ticketId, data) => {
    var cardTxt = fs.readFileSync('./cards/ticket.json', 'UTF-8');

    cardTxt = cardTxt.replace(/{ticketId}/g, ticketId)
                    .replace(/{severity}/g, data.severity)
                    .replace(/{category}/g, data.category)
                    .replace(/{description}/g, data.description);

    return JSON.parse(cardTxt);
};
