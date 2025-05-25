const { app } = require('@azure/functions');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

function renderHtml(episodes) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reddit2Podcast Episodes</title>
  <style>
    body { font-family: sans-serif; background: #f6f6f6; padding: 2rem; color: #333; }
    .episode-card {
      background: white;
      padding: 1rem 1.5rem;
      margin-bottom: 1rem;
      border-left: 4px solid #0078D4;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .episode-card h2 { margin: 0 0 0.5rem 0; }
    .episode-card a { color: #0078D4; text-decoration: none; font-size: 0.8em; }
    .meta { font-size: 0.9em; color: #666; margin-bottom: 0.5rem; }
    .summary { font-size: 0.9em; color: #666; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>🎙️ Reddit2Podcast Episodes</h1>
  ${episodes.map(ep => `
    <div class="episode-card">
      <h2>Episode – ${ep.date}</h2>
      <div class="meta">Subreddit: <strong>${ep.subreddit}</strong> | Created: ${ep.createdOn || 'N/A'}</div>
      <p class="summary">${ep.summary}</p>
      <audio controls src="${ep.audioUrl}"></audio><br />
      <a href="${ep.jsonUrl}" target="_blank">View JSON</a> |
      <a href="${ep.ssmlUrl}" target="_blank">View SSML</a>
    </div>
  `).join('')}
</body>
</html>`;
}

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
        body: renderHtml(episodes)
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
