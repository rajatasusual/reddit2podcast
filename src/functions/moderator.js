const { app } = require('@azure/functions');
const ContentSafetyClient = require("@azure-rest/ai-content-safety").default,
  { isUnexpected } = require("@azure-rest/ai-content-safety");
const { AzureKeyCredential } = require("@azure/core-auth");

const { default: pRetry, AbortError } = require('p-retry');

require("dotenv").config();

async function moderateContent(text, context) {
  try {
    const endpoint = process.env["CONTENT_SAFETY_ENDPOINT"];
    const key = process.env["CONTENT_SAFETY_KEY"];

    const credential = new AzureKeyCredential(key);
    const client = ContentSafetyClient(endpoint, credential);

    const analyzeTextOption = { text };
    const analyzeTextParameters = { body: analyzeTextOption };

    const result = await client.path("/text:analyze").post(analyzeTextParameters);

    if (isUnexpected(result)) {
      throw result;
    }

    return result.body;

  } catch (err) {
    context.log(`Error moderating content: ${err.message}`);
    throw err;
  }
}

async function moderateThread(thread, context) {
  const retryOptions = {
    onFailedAttempt: error => {
      if (error.message.includes('429')) {
        context.log(`Rate limited. Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
      }
      else {
        context.log(`Error moderating content: ${error.message}`);
        throw new AbortError(error.message);
      }
    },
    retries: 5,
  };

  const titleModerationResult = await pRetry(() => moderateContent(thread.title, context), retryOptions);

  const commentsModerationResults = await Promise.all(thread.comments.map(comment =>
    pRetry(() => moderateContent(comment, context), retryOptions)
  ));

  if (titleModerationResult.blocklistsMatch.length > 0) {
    thread.title = 'REDACTED';
  }
  if (commentsModerationResults.some(result => result.blocklistsMatch.length > 0)) {
    thread.comments = thread.comments.map((comment, i) =>
      commentsModerationResults[i].blocklistsMatch.length > 0 ? 'REDACTED' : comment
    );
  }

  return thread;
}

app.http('moderate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'moderate',
  handler: async (request, context) => {
    const content = request.params;
    if (typeof content !== 'string') {
      context.log('Invalid user info in request body.');
      return {
        status: 400,
        body: 'Bad Request'
      };
    }

    try {
      const moderationResults = await moderateContent(content, context);
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