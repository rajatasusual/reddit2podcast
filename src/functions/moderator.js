const { app } = require('@azure/functions');
const ContentSafetyClient = require("@azure-rest/ai-content-safety").default,
  { isUnexpected } = require("@azure-rest/ai-content-safety");
const { AzureKeyCredential } = require("@azure/core-auth");

const { default: pRetry, AbortError } = require('p-retry');

require("dotenv").config();

async function moderateContent(text, context) {
  try {
    const secretClient = require("./shared/keyVault").getSecretClient();
    
    const endpoint = process.env["CONTENT_SAFETY_ENDPOINT"] ?? (await secretClient.getSecret("CONTENT-SAFETY-ENDPOINT")).value;
    const key = process.env["CONTENT_SAFETY_KEY"] ?? (await secretClient.getSecret("CONTENT-SAFETY-KEY")).value;

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
      } else {
        context.log(`Error moderating content: ${error.message}`);
        throw new AbortError(error.message);
      }
    },
    retries: 5,
  };

  function isViolation(moderationResult) {
    // Redact if any blocklist match or any category severity > 0
    if (moderationResult.blocklistsMatch && moderationResult.blocklistsMatch.length > 0) return true;
    if (moderationResult.categoriesAnalysis) {
      return moderationResult.categoriesAnalysis.some(cat => cat.severity > 2);
    }
    return false;
  }

  // Moderate title
  const titleModerationResult = await pRetry(() => moderateContent(thread.title, context), retryOptions);

  // Moderate comments
  const commentsModerationResults = await Promise.all(
    thread.comments.map(comment =>
      pRetry(() => moderateContent(comment, context), retryOptions)
    )
  );

  // Return empty title if violation
  if (isViolation(titleModerationResult)) {
    thread.title = '';
  }

  // Return empty comments if violation
  thread.comments = thread.comments.map((comment, i) =>
    isViolation(commentsModerationResults[i]) ? '' : comment
  );

  return thread;
}

app.http('moderate', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'moderate',
  handler: async (request, context) => {
    // Get documents array from request body
   const body = await request.json() || {};
    if (!Array.isArray(body.documents)) {
      return { status: 400, body: "Missing or invalid 'documents' array." };
    }
    try {
      // Process each document asynchronously
      const moderationResults = await Promise.all(
        body.documents.map(doc => moderateContent(doc, context))
      );
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moderationResults)
      };
    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error. Could not moderate content.',
          message: err.message,
          stack: err.stack
        })
      };
    }
  }
});

module.exports = {
  moderateContent,
  moderateThread
}