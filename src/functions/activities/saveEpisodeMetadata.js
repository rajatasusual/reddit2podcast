
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

module.exports.saveEpisodeMetadata = async function saveEpisodeMetadata(metadata, context) {
  
  context.log('Saving episode metadata...');

  const tableName = "PodcastEpisodes";
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCOUNT_KEY)
  );

  await tableClient.createTable(); // Creates only if not exists

  const entity = {
    partitionKey: "episodes",
    rowKey: metadata.episodeId,
    subreddit: metadata.subreddit,
    audioUrl: metadata.audioUrl,
    jsonUrl: metadata.jsonUrl,
    ssmlUrl: metadata.ssmlUrl,
    createdOn: new Date().toISOString(),
    summary: metadata.summary
  };

  await tableClient.upsertEntity(entity);

  context.log('Episode metadata saved.');
}