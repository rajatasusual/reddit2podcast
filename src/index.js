const { app } = require('@azure/functions');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

app.setup({
  enableHttpStream: true,
});

app.http('episodes', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {

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
            createdOn: entity.createdOn
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(episodes)
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
