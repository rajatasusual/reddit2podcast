const { AzureKeyCredential, TextAnalysisClient } = require("@azure/ai-language-text");
const { app } = require('@azure/functions');
require("dotenv").config();

const endpoint = process.env.ENDPOINT_TO_CALL_LANGUAGE_API;
const apiKey = process.env.AZURE_AI_KEY;

app.http('extractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    context.log("== Extractive Summarization Sample ==");

    const documents = request.body.documents;

    try {
      const results = await performSummarization(documents, 'Extractive', context);
      context.res = {
        status: 200,
        body: results
      };
    } catch (err) {
      context.log(err);
      context.res = {
        status: 500,
        body: err
      };
    }
  }
});

app.http('abstractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    context.log("== Abstractive Summarization Sample ==");

    const documents = request.body.documents;

    try {
      const results = await performSummarization(documents, 'Abstractive', context);
      context.res = {
        status: 200,
        body: results
      };
    } catch (err) {
      context.log(err);
      context.res = {
        status: 500,
        body: err
      };
    }
  }
});

async function performSummarization(documents, type, context) {
  const client = new TextAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  const actions = [
    {
      kind: `${type}Summarization`,
      ...type === 'Extractive' ? { maxSentenceCount: 1 } : { sentenceCount: 1 }
    },
  ];
  const poller = await client.beginAnalyzeBatch(actions, documents, "en");

  poller.onProgress(() => {
    context.log(
      `Last time the operation was updated was on: ${poller.getOperationState().modifiedOn}`
    );
  });
  context.log(`The operation was created on ${poller.getOperationState().createdOn}`);
  context.log(`The operation results will expire on ${poller.getOperationState().expiresOn}`);

  try {
    const results = await poller.pollUntilDone();

    let summary = "";
    for await (const actionResult of results) {
      if (actionResult.kind !== `${type}Summarization`) {
        throw new Error(`Expected ${type.toLowerCase()} summarization results but got: ${actionResult.kind}`);
      }
      if (actionResult.error) {
        const { code, message } = actionResult.error;
        throw new Error(`Unexpected error (${code}): ${message}`);
      }
      for (const result of actionResult.results) {
        context.log(`- Document ${result.id}`);
        if (result.error) {
          const { code, message } = result.error;
          throw new Error(`Unexpected error (${code}): ${message}`);
        }
        context.log("Summary:");
        const resultText = type === 'Extractive' 
          ? result.sentences.map((sentence) => sentence.text).join(".\n")
          : result.summaries.map((summary) => summary.text).join(".\n");
        context.log(resultText);
        summary += resultText;
      }
    }

    context.log(`Operation completed on ${poller.getOperationState().modifiedOn}`);

    return summary;
  } catch (err) {
    context.log("The operation encountered an error:", err);
  }
}

async function abstractiveSummarization(documents, context) {
  return await performSummarization(documents, 'Abstractive', context);
}

async function extractiveSummarization(documents, context) {
  return await performSummarization(documents, 'Extractive', context);
}

module.exports = {
  abstractiveSummarization,
  extractiveSummarization
};
