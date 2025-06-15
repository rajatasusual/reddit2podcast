const { TextAnalysisClient, AzureKeyCredential } = require("@azure/ai-language-text");

require("dotenv").config();

const { getSecretClient } = require('../shared/keyVault');

class NLQProcessor {

  static instance;

  constructor() {
    this.initialized = false;
  }

  static getInstance() {
    if (!NLQProcessor.instance) {
      NLQProcessor.instance = new NLQProcessor();
    }
    return NLQProcessor.instance;
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

module.exports = NLQProcessor.getInstance();