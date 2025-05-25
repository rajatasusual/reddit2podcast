const { app } = require('@azure/functions');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

const { generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const { StorageSharedKeyCredential } = require('@azure/storage-blob');

async function createOrRetrieveSASToken(userInfo) {
  const tableName = "Users";
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(
      process.env.AZURE_STORAGE_ACCOUNT,
      process.env.AZURE_STORAGE_ACCOUNT_KEY
    )
  );

  await tableClient.createTable(); // Creates only if not exists

  const entity = await tableClient.getEntity("users", episodeQuery).catch(() => null);
  if (entity) {
    return entity.sasToken;
  } else {
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

    const sasToken = generateBlobSASQueryParameters({
      containerName,
      blobName,
      expiresOn: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
      permissions: BlobSASPermissions.parse("r")
    }, sharedKeyCredential).toString();

    tableClient.upsertEntity({
      partitionKey: "users",
      createdOn: new Date().toISOString(),
      sasToken,
      ...userInfo
    });

    return sasToken;
  }

}

app.setup({
  enableHttpStream: true,
});

app.http('episodes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {

    const userInfo = request.body;
    if (!userInfo || typeof userInfo !== 'object') {
      return {
        status: 400,
        body: 'Bad Request'
      };
    }

    const sasToken = await createOrRetrieveSASToken(userInfo);

    const tableName = "PodcastEpisodes";
    const tableClient = new TableClient(
      `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
      tableName,
      new AzureNamedKeyCredential(
        process.env.AZURE_STORAGE_ACCOUNT,
        process.env.AZURE_STORAGE_ACCOUNT_KEY
      )
    );

    const episodeQuery = request.query.get('episode'); // ?episode=YYYY-MM-DD
    context.log(`🔍 Looking up episode(s). Filter: ${episodeQuery || 'all'}`);

    try {
      const episodes = [];

      if (episodeQuery) {
        // Get specific episode
        const entity = await tableClient.getEntity("episodes", episodeQuery).catch(() => null);
        if (entity) {
          episodes.push({
            date: entity.rowKey,
            subreddit: entity.subreddit,
            audioUrl: entity.audioUrl,
            jsonUrl: entity.jsonUrl,
            ssmlUrl: entity.ssmlUrl,
            createdOn: entity.createdOn
          });
        }
      } else {
        // Get all episodes
        const entities = tableClient.listEntities({ queryOptions: { filter: `PartitionKey eq 'episodes'` } });
        for await (const entity of entities) {
          episodes.push({
            date: entity.rowKey,
            subreddit: entity.subreddit,
            audioUrl: entity.audioUrl,
            jsonUrl: entity.jsonUrl,
            ssmlUrl: entity.ssmlUrl,
            createdOn: entity.createdOn,
            summary: entity.summary
          });
        }

        // Sort by date descending
        episodes.sort((a, b) => new Date(b.date) - new Date(a.date));
      }

      if (episodes.length === 0) {
        context.log(`⚠️ No episodes found for: ${episodeQuery || 'all'}`);
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: `No episodes found for: ${episodeQuery || 'all'}` })
        };
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: { episodes, sasToken }
      };

    } catch (err) {
      context.log(`💥 Error retrieving episodes: ${err.message}`);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Internal server error. Could not retrieve episodes.' }
      };
    }
  }
});
