
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

module.exports.saveEpisodeMetadata = async function saveEpisodeMetadata(input, context) {
  
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
    rowKey: input.episodeId,
    subreddit: input.subreddit,
    audioUrl: input.audioUrl,
    jsonUrl: input.jsonUrl,
    ssmlUrl: input.ssmlUrl,
    createdOn: new Date().toISOString(),
    summary: input.summary
  };

  await tableClient.upsertEntity(entity);

  context.log('Episode metadata saved.');
}