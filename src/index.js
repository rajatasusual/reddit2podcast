const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');


app.setup({
  enableHttpStream: true,
});

app.http('episodes', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'episodes',
  handler: async (request, context) => {
    const episodeQuery = request.query.get('episode'); // ?episode=YYYY-MM-DD
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient('reddit2podcast-audio');

    const jsonPrefix = 'json/';
    const audioPrefix = 'audio/';

    context.log(`🔍 Looking for episodes. Filter: ${episodeQuery || 'none'}`);

    const episodes = [];

    async function streamToString(stream) {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf8');
    }

    try {
      // Only list blobs under the json/ "folder"
      for await (const blob of containerClient.listBlobsFlat({ prefix: jsonPrefix })) {
        const name = blob.name;
        
        if (!name.endsWith('.json')) continue;

        const match = name.match(/^json\/episode-(\d{4}-\d{2}-\d{2})\.json$/);
        if (!match) continue;

        const date = match[1];
        if (episodeQuery && episodeQuery !== date) continue;

        const jsonBlobClient = containerClient.getBlobClient(name);
        const audioBlobClient = containerClient.getBlobClient(`${audioPrefix}episode-${date}.wav`);

        // Download and parse JSON metadata
        const downloadResp = await jsonBlobClient.download();
        const jsonData = JSON.parse(await streamToString(downloadResp.readableStreamBody));

        context.log(`✅ Found episode ${date}`);

        episodes.push({
          date,
          title: jsonData.title || `Episode ${date}`,
          jsonUrl: jsonBlobClient.url,
          audioUrl: audioBlobClient.url
        });

        if (episodeQuery) break; // No need to keep searching
      }

      if (episodes.length === 0) {
        context.log(`⚠️ No episodes found for query: ${episodeQuery || 'all'}`);
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'No episodes found.' }
        };
      }

      // Sort by date, descending
      episodes.sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: episodes
      };

    } catch (err) {
      context.log(`💥 Error fetching episodes: ${err.message}`);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Internal server error. Could not retrieve episodes.' }
      };
    }
  }
});
