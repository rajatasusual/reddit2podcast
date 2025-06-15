const { AzureKeyCredential, TextAnalysisClient } = require("@azure/ai-language-text");
const { app } = require('@azure/functions');
require("dotenv").config();

const { getSecretClient } = require('./shared/keyVault');

class LanguageClientManager {
  static instance;

  constructor() {
    this.initialized = false;
  }

  static getInstance() {
    if (!LanguageClientManager.instance) {
      LanguageClientManager.instance = new LanguageClientManager();
    }
    return LanguageClientManager.instance;
  }

  async init() {
    if (this.initialized) return;

    const secretClient = getSecretClient();

    this.endpoint = process.env.ENDPOINT_TO_CALL_LANGUAGE_API ||
      (await secretClient.getSecret("ENDPOINT-TO-CALL-LANGUAGE-API")).value;

    this.apiKey = process.env.AZURE_AI_KEY ||
      (await secretClient.getSecret("AZURE-AI-KEY")).value;

    this.client = new TextAnalysisClient(this.endpoint, new AzureKeyCredential(this.apiKey));
    this.initialized = true;
  }

  async getClient() {
    await this.init();
    return this.client;
  }

  async parseQuery(naturalQuery) {

    const results = await (await this.getClient()).analyze("EntityRecognition", [naturalQuery], "en");
    return this._normalizeEntities(results[0].entities);
  }

  _normalizeEntities(entities) {
    return entities.map(e => ({
      text: e.text,
      category: e.category,
      subCategory: e.subCategory,
      confidence: e.confidenceScore,
      offset: e.offset
    }));
  }
}

async function performSummarization(documents, type, context) {
  context.log(`Performing ${type} summarization`);

  const languageClient = await LanguageClientManager.getInstance().getClient();

  const actions = [{
    kind: `${type}Summarization`,
    ...(type === 'Extractive' ? { maxSentenceCount: 1 } : { sentenceCount: 1 })
  }];

  try {
    const poller = await languageClient.beginAnalyzeBatch(actions, documents, "en");
    const results = await poller.pollUntilDone();
    let summary = "";

    for await (const actionResult of results) {
      // This is a critical error affecting the entire batch action.
      // We should still throw this.
      if (actionResult.error) {
        const { code, message } = actionResult.error;
        throw new Error(`Critical batch error (${code}): ${message}`);
      }
      if (actionResult.kind !== `${type}Summarization`) {
        throw new Error(`Expected ${type.toLowerCase()} summarization, got ${actionResult.kind}`);
      }

      for (const result of actionResult.results) {
        // GRACEFUL HANDLING: Check for an error on a single document.
        if (result.error) {
          const { code, message } = result.error;
          // Log the specific document error and continue to the next one.
          context.log(`Warning: Could not summarize document ${result.id}. Error (${code}): ${message}`);
          continue; // Move to the next result without stopping.
        }

        // If no error, process the result as before.
        const resultText = type === 'Extractive'
          ? result.sentences.map(s => s.text).join(".\n")
          : result.summaries.map(s => s.text).join(".\n");
        summary += '\n' + resultText;
      }
    }

    return summary.trim();
  } catch (err) {
    // This will catch critical errors (e.g., authentication, network, batch failure).
    context.log("A critical summarization error occurred:", err);
    throw err;
  }
}

app.http('extractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'summarize/extractive',
  handler: async (request, context) => {
    const body = await request.json() || {};
    if (!Array.isArray(body.documents)) {
      return { status: 400, body: "Missing or invalid 'documents' array." };
    }

    try {
      const result = await performSummarization(body.documents, 'Extractive', context);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error. Could not summarize content.',
          message: err.message,
          stack: err.stack
        })
      };
    }
  }
});

app.http('abstractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'summarize/abstractive',
  handler: async (request, context) => {
    const body = await request.json() || {};
    if (!Array.isArray(body.documents)) {
      return { status: 400, body: "Missing or invalid 'documents' array." };
    }

    try {
      const result = await performSummarization(body.documents, 'Abstractive', context);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error. Could not summarize content.',
          message: err.message,
          stack: err.stack
        })
      };
    }
  }
});

module.exports = {
  abstractiveSummarization: async (docs, ctx) => await performSummarization(docs, 'Abstractive', ctx),
  extractiveSummarization: async (docs, ctx) => await performSummarization(docs, 'Extractive', ctx),
  LanguageClientManager: LanguageClientManager.getInstance(),
};
