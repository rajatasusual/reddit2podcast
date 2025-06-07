const { app } = require('@azure/functions');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');
const { generateBlobSASQueryParameters, ContainerSASPermissions, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { getSecretClient } = require('./shared/keyVault');

class CredentialManager {
  static instance;

  constructor() {
    this.initialized = false;
  }

  static getInstance() {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  async init() {
    if (this.initialized) return;

    const secretClient = getSecretClient();
    this.accountName = process.env.AZURE_STORAGE_ACCOUNT;
    this.accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY ||
      (await secretClient.getSecret("AZURE-STORAGE-ACCOUNT-KEY")).value;

    this.sharedKeyCredential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
    this.namedKeyCredential = new AzureNamedKeyCredential(this.accountName, this.accountKey);

    this.initialized = true;
  }

  async getSharedKeyCredential() {
    await this.init();
    return this.sharedKeyCredential;
  }

  async getNamedKeyCredential() {
    await this.init();
    return this.namedKeyCredential;
  }
}

class TableManager {
  constructor(tableName) {
    this.tableName = tableName;
    this.client = null;
  }

  async init() {
    const credentials = await CredentialManager.getInstance().getNamedKeyCredential();
    this.client = new TableClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
      this.tableName,
      credentials
    );

    try {
      await this.client.createTable();
    } catch (err) {
      if (err.statusCode !== 409) { // Table already exists
        console.error(`Error creating/accessing table ${this.tableName}: ${err.message}`);
        throw new Error(`Failed to access table: ${this.tableName}`);
      }
    }
  }

  getClient() {
    if (!this.client) throw new Error("TableManager not initialized");
    return this.client;
  }
}

async function createOrRetrieveSASToken(userInfo) {
  const usersTable = new TableManager("Users");
  await usersTable.init();
  const tableClient = usersTable.getClient();

  const entity = await tableClient.getEntity("users", userInfo.userId).catch(() => null);
  if (entity?.sasToken) {
    const expiryDate = new Date(entity.createdOn);
    expiryDate.setHours(expiryDate.getHours() + 24);
    if (expiryDate > new Date()) {
      console.log("Reusing existing SAS token.");
      return entity.sasToken;
    }
  }

  const sharedKeyCredential = await CredentialManager.getInstance().getSharedKeyCredential();

  const sasToken = generateBlobSASQueryParameters({
    containerName: `${process.env.AZURE_STORAGE_ACCOUNT}-audio`,
    permissions: ContainerSASPermissions.parse("r"),
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }, sharedKeyCredential).toString();

  await tableClient.upsertEntity({
    partitionKey: "users",
    rowKey: userInfo.userId,
    sasToken,
    createdOn: new Date().toISOString(),
    identityProvider: userInfo.identityProvider,
    userId: userInfo.userId,
    userDetails: userInfo.userDetails,
  });

  console.log("Generated and saved new SAS token.");
  return sasToken;
}

app.http('episodes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {
    const userInfo = request.params;

    if (!userInfo || typeof userInfo !== 'object') {
      context.log('Invalid user info in request body.');
      return { status: 400, body: 'Bad Request' };
    }

    try {
      const sasToken = await createOrRetrieveSASToken(userInfo);

      const tableManager = new TableManager("PodcastEpisodes");
      await tableManager.init();
      const tableClient = tableManager.getClient();

      // Get subreddit from query
      const subredditQuery = request.query.get('subreddit');
      context.log(`Querying episodes. Subreddit filter: ${subredditQuery || 'all'}`);

      const episodes = [];

      // Build filter string for Azure Table query
      let filter = `PartitionKey eq 'episodes'`;
      if (subredditQuery) {
        // Escape single quotes for OData filter
        const escapedSubreddit = subredditQuery.replace(/'/g, "''");
        filter += ` and subreddit eq '${escapedSubreddit}'`;
      }

      const entities = tableClient.listEntities({ queryOptions: { filter } });
      for await (const entity of entities) {
        episodes.push({
          title: entity.rowKey,
          subreddit: entity.subreddit,
          audioUrl: entity.audioUrl,
          jsonUrl: entity.jsonUrl,
          ssmlUrl: entity.ssmlUrl,
          createdOn: entity.createdOn,
          summary: entity.summary,
          transcriptsUrl: entity.transcriptsUrl
        });
      }
      episodes.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));

      if (!episodes.length) {
        context.log("No episodes found.");
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: `No episodes found for: ${subredditQuery || 'all'}` })
        };
      }

      context.log("Episodes retrieved successfully.");
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, sasToken })
      };

    } catch (err) {
      context.log(`Error retrieving episodes: ${err.message}`);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error. Could not retrieve episodes.',
          message: err.message,
          stack: err.stack
        })
      };
    }
  }
});
