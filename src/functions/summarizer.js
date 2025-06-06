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
}

async function performSummarization(documents, type, context) {
  context.log(`Performing ${type} summarization`);

  const client = await LanguageClientManager.getInstance().getClient();

  const actions = [{
    kind: `${type}Summarization`,
    ...(type === 'Extractive' ? { maxSentenceCount: 1 } : { sentenceCount: 1 })
  }];

  const poller = await client.beginAnalyzeBatch(actions, documents, "en");

  try {
    const results = await poller.pollUntilDone();
    let summary = "";

    for await (const actionResult of results) {
      if (actionResult.kind !== `${type}Summarization`) {
        throw new Error(`Expected ${type.toLowerCase()} summarization, got ${actionResult.kind}`);
      }
      if (actionResult.error) {
        const { code, message } = actionResult.error;
        throw new Error(`Error (${code}): ${message}`);
      }
      for (const result of actionResult.results) {
        if (result.error) {
          const { code, message } = result.error;
          throw new Error(`Error (${code}): ${message}`);
        }
        const resultText = type === 'Extractive'
          ? result.sentences.map(s => s.text).join(".\n")
          : result.summaries.map(s => s.text).join(".\n");
        summary += '\n' + resultText;
      }
    }

    return summary.trim();
  } catch (err) {
    context.log("Summarization error:", err);
    throw err;
  }
}

app.http('extractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const { documents } = request.body || {};
    if (!Array.isArray(documents)) {
      context.res = { status: 400, body: "Missing or invalid 'documents' array." };
      return;
    }

    try {
      const result = await performSummarization(documents, 'Extractive', context);
      context.res = { status: 200, body: result };
    } catch (err) {
      context.res = { status: 500, body: err.message };
    }
  }
});

app.http('abstractiveSummarization', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const { documents } = request.body || {};
    if (!Array.isArray(documents)) {
      context.res = { status: 400, body: "Missing or invalid 'documents' array." };
      return;
    }

    try {
      const result = await performSummarization(documents, 'Abstractive', context);
      context.res = { status: 200, body: result };
    } catch (err) {
      context.res = { status: 500, body: err.message };
    }
  }
});

module.exports = {
  abstractiveSummarization: async (docs, ctx) => await performSummarization(docs, 'Abstractive', ctx),
  extractiveSummarization: async (docs, ctx) => await performSummarization(docs, 'Extractive', ctx),
};
