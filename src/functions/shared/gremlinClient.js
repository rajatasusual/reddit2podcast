// gremlinClient.js
const gremlin = require('gremlin');

require("dotenv").config();
const { getSecretClient } = require('./keyVault');

class CosmosGremlinClient {
	static getInstance() {
		if (!CosmosGremlinClient.instance) {
			CosmosGremlinClient.instance = new CosmosGremlinClient();
		}
		return CosmosGremlinClient.instance;
	}

	constructor() {
		if (CosmosGremlinClient.instance) {
			throw new Error('Singleton instantiation attempted.');
		}
		CosmosGremlinClient.instance = this;

		this.initialized = false;
	}

	async init() {
		if (!this.initialized) {
			const secretClient = getSecretClient();
			const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(
				`/dbs/${process.env.COSMOS_DATABASE_ID}/colls/${process.env.COSMOS_CONTAINER_ID}`,
				process.env.COSMOS_KEY || (await secretClient.getSecret('COSMOS-KEY')).value
			);

			this.client = new gremlin.driver.Client(
				process.env.COSMOS_GREMLIN_ENDPOINT || (await secretClient.getSecret('COSMOS-GREMLIN-ENDPOINT')).value,
				{
					authenticator,
					traversalSource: 'g',
					rejectUnauthorized: true,
					mimeType: 'application/vnd.gremlin-v2.0+json'
				}
			);

			this.initialized = true;
		}
	}

	async getClient() {
		await this.init();
		return this.client;
	}

	async executeQuery(query, bindings = {}) {
		const client = await this.getClient();
		try {
			const result = await client.submit(query, bindings);
			return result._items;
		} catch (error) {
			console.error('Gremlin query execution error:', error);
			throw error;
		}
	}

	async close() {
		if (this.client) {
			await this.client.close();
			this.client = null;
			this.initialized = false;
		}
	}
}

module.exports = CosmosGremlinClient.getInstance();

