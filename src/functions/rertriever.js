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

async function getEpisodes(subredditQuery = null, episodeIds = null) {
  const tableManager = new TableManager("PodcastEpisodes");
  await tableManager.init();
  const tableClient = tableManager.getClient();

  const episodes = [];

  // Collect individual filter clauses
  const filters = [`PartitionKey eq 'episodes'`];

  if (subredditQuery) {
    // Escape single quotes for OData filter
    const escaped = subredditQuery.replace(/'/g, "''");
    filters.push(`subreddit eq '${escaped}'`);
  }

  if (episodeIds) {
    let rowKeyClause;
    if (Array.isArray(episodeIds) && episodeIds.length > 0) {
      // Build: (rowKey eq 'id1' or rowKey eq 'id2' or ...)
      const orParts = episodeIds.map(id => {
        const escapedId = id.replace(/'/g, "''");
        return `RowKey eq '${escapedId}'`;
      });
      rowKeyClause = `(${orParts.join(' or ')})`;
    } else {
      return [];
    }
    filters.push(rowKeyClause);
  }

  // Join all clauses with "and"
  const filter = filters.join(' and ');

  // Query
  const entities = tableClient.listEntities({ queryOptions: { filter } });
  for await (const e of entities) {
    episodes.push({
      title: e.rowKey,
      subreddit: e.subreddit,
      audioUrl: e.audioUrl,
      jsonUrl: e.jsonUrl,
      ssmlUrl: e.ssmlUrl,
      createdOn: e.createdOn,
      summary: e.summary,
      transcriptsUrl: e.transcriptsUrl
    });
  }

  // Sort newest first
  episodes.sort(
    (a, b) => new Date(b.createdOn) - new Date(a.createdOn)
  );

  return episodes;
}

app.http('episodes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {
    let userInfo;
    try {
      userInfo = await request.json();
    } catch (err) {
      context.log('Failed to parse request body.');
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    if (!userInfo || typeof userInfo !== 'object') {
      context.log('Invalid user info in request body.');
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing or invalid user info' })
      };
    }

    try {
      // Get subreddit from query
      const subredditQuery = request.query.get('subreddit');
      context.log(`Querying episodes. Subreddit filter: ${subredditQuery || 'all'}`);

      const sasToken = await createOrRetrieveSASToken(userInfo);

      const episodes = await getEpisodes(subredditQuery);

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

app.http('subreddits', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'subreddits',
  handler: async (request, context) => {
    const tableManager = new TableManager("PodcastEpisodes");
    await tableManager.init();
    const tableClient = tableManager.getClient();

    const subreddits = new Set();
    const entities = tableClient.listEntities({ queryOptions: { filter: `PartitionKey eq 'episodes'` } });
    for await (const e of entities) {
      subreddits.add(e.subreddit);
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([...subreddits])
    };
  }
});


app.http('categories', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'categories',
  handler: async (request, context) => {
    const service = require('./helper/entitySearchService');
    const categories = await service.listCategories();
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categories)
    };
  }
});

app.http('subCategories', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'subcategories',
  handler: async (request, context) => {
    const categories = request.query && decodeURIComponent(request.query.get('q'));
    if (categories) {
      const service = require('./helper/entitySearchService');

      const subCategoriesMap = [];

      for (const category of categories.split(',')) {
        const subCategories = await service.listSubCategories(category);
        for (const subCategory of subCategories) {
          if (subCategory === '' || subCategoriesMap.some(item => item.name === subCategory)) {
            continue;
          }
          subCategoriesMap.push({ value: subCategory, label: subCategory });
        }
      }
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subCategoriesMap)
      };


    } else {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing or invalid categories parameter' })
      };
    }

  }
});

app.http('dateRange', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'date-range',
  handler: async (request, context) => {
    const tableManager = new TableManager("PodcastEpisodes");
    await tableManager.init();
    const tableClient = tableManager.getClient();

    const entities = tableClient.listEntities({
      queryOptions: {
        filter: `PartitionKey eq 'episodes'`,
        select: ['TimeStamp']
      }
    });

    function extractDate(encodedString) {
      // Match the datetime portion using regex
      const match = encodedString.match(/datetime'(.*?)'/);
      if (!match || !match[1]) return null;

      // Decode URI components (e.g., %3A becomes :)
      const decodedDateStr = decodeURIComponent(match[1]);

      // Convert to Date object
      const date = new Date(decodedDateStr);

      // Check for valid date
      return isNaN(date.getTime()) ? null : date;
    }

    const dates = [];
    for await (const e of entities) {
      const date = extractDate(e.etag);
      if (date) {
        dates.push(date.getTime());
      }
    }

    const minDate = new Date(Math.min(...dates)).toISOString().split('T')[0];
    const maxDate = new Date(Math.max(...dates)).toISOString().split('T')[0];

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minDate, maxDate })
    };
  }
});

app.http('graphQuery', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'query',
  handler: async (request, context) => {
    const query = request.query?.get('q');

    if (!query) {
      return { status: 400, body: "Missing or invalid 'q' parameter." };
    }

    try {
      const service = require('./helper/entitySearchService');
      const documents = await service.findDocumentsForQuery(query);

      const episodeIds = documents.map(doc => doc.id);
      const episodes = await getEpisodes(null, episodeIds);

      return { status: 200, body: JSON.stringify({ episodes, documents }) };
    } catch (error) {
      context.log("Query Error:", error);
      return { status: 500, body: "Query processing failed" };
    }
  }
});


app.http('entitySearch', {
  methods: ['POST'],
  authLevel: 'anonymous', // Or 'function' for key-based auth
  route: 'search',
  handler: async function (request, context) {
    context.log('Entity search API called');

    const entitySearchService = require('./helper/entitySearchService');

    try {
      const body = await request.json() || {};
      const { searchType, category, query, entityTexts, documentId, maxHops, limit, minOccurrences } = body;

      // --- Centralized Input Validation ---
      if (!searchType) {
        return { status: 400, body: JSON.stringify({ error: "Missing required 'searchType' property." }) };
      }

      let results;

      // --- API Routing Logic ---
      switch (searchType) {
        case 'category':
          if (!category) return { status: 400, body: JSON.stringify({ error: "Missing 'category' parameter for this search type." }) };
          results = await entitySearchService.findEntitiesByCategory(category, parseInt(limit) || 100);
          break;

        case 'related':
          if (!query) return { status: 400, body: JSON.stringify({ error: "Missing 'query' parameter for this search type." }) };
          results = await entitySearchService.findRelatedEntities(query, parseInt(maxHops) || 2, parseInt(limit) || 50);
          break;

        case 'entities_in_document':
          if (!documentId) return { status: 400, body: JSON.stringify({ error: "Missing 'documentId' parameter for this search type." }) };
          results = await entitySearchService.findEntitiesInDocument(documentId);
          break;

        case 'documents_for_entity':
          if (!query) return { status: 400, body: JSON.stringify({ error: "Missing 'query' parameter for this search type." }) };
          results = await entitySearchService.findDocumentsForEntity(query, parseInt(limit) || 50);
          break;

        case 'pattern':
          if (!query) return { status: 400, body: JSON.stringify({ error: "Missing 'query' parameter for this search type." }) };
          results = await entitySearchService.searchEntitiesByTextPattern(query, category); // category is optional here
          break;

        case 'frequent_co_occurring':
          results = await entitySearchService.findFrequentCoOccurringEntities(parseInt(minOccurrences) || 5, parseInt(limit) || 20);
          break;

        case 'common_connections':
          if (!entityTexts || !Array.isArray(entityTexts) || entityTexts.length < 2) {
            return { status: 400, body: JSON.stringify({ error: "Missing or invalid 'entityTexts' parameter. It must be an array of at least two strings." }) };
          }
          results = await entitySearchService.findCommonConnections(entityTexts, parseInt(limit) || 10);
          break;

        default:
          const supportedTypes = [
            'category', 'related', 'entities_in_document', 'documents_for_entity',
            'pattern', 'frequent_co_occurring', 'common_connections'
          ];
          return {
            status: 400,
            body: JSON.stringify({ error: `Invalid search type. Supported types are: ${supportedTypes.join(', ')}` })
          };
      }

      // --- Success Response ---
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchType,
          resultCount: results.length,
          results
        })
      };

    } catch (err) {
      // --- Secure Error Handling ---
      context.log('Entity Search Function Error:', { message: err.message, stack: err.stack });
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'An internal server error occurred while processing the search request.'
        })
      };
    }
  }
});
