const { app } = require('@azure/functions');
require("dotenv").config();

async function moderateContent(contentInfo, context) {
  try {
    const response = await fetch(process.env.CONTENT_SAFETY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': process.env.CONTENT_SAFETY_KEY
      },
      body: JSON.stringify(contentInfo)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Error calling content safety service: ${response.status} ${response.statusText}. ${error.message}`);
    }

    return await response.json();

  } catch (err) {
    context.log(`💥 Error moderating content: ${err.message}`);
    throw err;
  }
}

async function moderateThread(thread, context) {
  const titleModerationResult = await moderateContentWithRetry({ text: thread.title, haltOnBlocklistHit: false }, context);
  const commentsModerationResults = await Promise.all(thread.comments.map(comment => moderateContentWithRetry({ text: comment, haltOnBlocklistHit: false }, context)));

  async function moderateContentWithRetry(contentInfo, context, retryCount = 0) {
    try {
      return await moderateContent(contentInfo, context);
    } catch (error) {
      if (error.message.includes('429') && retryCount < 5) {
        const delay = 5000 * (retryCount + 1);
        context.log(`Rate limited. Waiting ${delay / 1000} seconds before retrying.`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await moderateContentWithRetry(contentInfo, context, retryCount + 1);
      } else {
        throw error;
      }
    }
  }

  if (titleModerationResult.blocklistsMatch.length > 0) {
    thread.title = 'REDACTED';
  }
  if (commentsModerationResults.some(result => result.blocklistsMatch.length > 0)) {
    thread.comments = thread.comments.map(comment => 'REDACTED');
  }

  return thread;
}

app.http('moderate', {
  methods: ['POST'],
  authLevel: 'authenticated',
  route: 'moderate',
  handler: async (request, context) => {
    const contentInfo = request.params;
    if (!contentInfo || typeof contentInfo !== 'object') {
      context.log('Invalid user info in request body.');
      return {
        status: 400,
        body: 'Bad Request'
      };
    }

    context.log(`👤 Content info: ${JSON.stringify(contentInfo)}`);

    try {
      const moderationResults = await moderateContent(contentInfo, context);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moderationResults)
      };

    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error. Could not moderate content.', message: err.message, stack: err.stack })
      };
    }
  }
});

module.exports = {
  moderateContent,
  moderateThread
}