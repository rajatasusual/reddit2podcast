
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

module.exports.saveEpisodeMetadata = async function saveEpisodeMetadata(input, context) {
  
  context.log('Saving episode metadata...');

  const secretClient = require('../shared/keyVault').getSecretClient();
  const AZURE_STORAGE_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY ?? await secretClient.getSecret("AZURE-STORAGE-ACCOUNT-KEY").value;

  const tableName = "PodcastEpisodes";
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_ACCOUNT_KEY)
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
    summary: input.summary,
    transcriptsUrl: input.transcriptsUrl
  };

  await tableClient.upsertEntity(entity);

  context.log('Episode metadata saved.');
}