const { app } = require('@azure/functions');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');
const { generateBlobSASQueryParameters, ContainerSASPermissions } = require('@azure/storage-blob');
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

  await tableClient.createTable().catch(err => {
    console.error(`Error creating table: ${err.message}`);
    throw new Error('Failed to create or access table.');
  });

  const entity = await tableClient.getEntity("users", userInfo.userId).catch(() => null);
  if (entity) {
    console.log('SAS token retrieved from existing entity.');
    return entity.sasToken;
  } else {
    const sharedKeyCredential = new StorageSharedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCOUNT_KEY);
    const sasOptions = {
      containerName: `${process.env.AZURE_STORAGE_ACCOUNT}-audio`,
      permissions: ContainerSASPermissions.parse("r")
    };

    sasOptions.startsOn = new Date();
    sasOptions.expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    console.log(`SAS token for blob container is: ${sasToken}`);

    await tableClient.upsertEntity({
      partitionKey: "users",
      createdOn: new Date().toISOString(),
      sasToken,
      rowKey: userInfo.userId,
      identityProvider: userInfo.identityProvider,
      userId: userInfo.userId,
      userDetails: userInfo.userDetails
    }).catch(err => {
      console.error(`Error upserting entity: ${err.message}`);
      throw new Error('Failed to save SAS token.');
    });

    console.log('SAS token generated and saved.');
    return sasToken;
  }
}

app.http('episodes', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {
    const userInfo = request.params;
    if (!userInfo || typeof userInfo !== 'object') {
      context.log('Invalid user info in request body.');
      return {
        status: 400,
        body: 'Bad Request'
      };
    }

    context.log(`👤 User info: ${JSON.stringify(userInfo)}`);

    try {
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

      const episodes = [];
      if (episodeQuery) {
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

      context.log('Episodes retrieved successfully.');
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: JSON.stringify({ episodes, sasToken })
      };

    } catch (err) {
      context.log(`💥 Error retrieving episodes: ${err.message}`);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error. Could not retrieve episodes.', message: err.message, stack: err.stack })
      };
    }
  }
});