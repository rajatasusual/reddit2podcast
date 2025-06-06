const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

const uploadBufferToPublicBlob = require('../shared/storageUtil').uploadBufferToPublicBlob;

module.exports.generateRSSFeed = async function generateRSSFeed() {
  const secretClient = require('../shared/keyVault').getSecretClient();
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    "PodcastEpisodes",
    new AzureNamedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCOUNT_KEY ?? await secretClient.getSecret("AZURE-STORAGE-ACCOUNT-KEY").value)
  );

  const episodes = [];
  for await (const entity of tableClient.listEntities({ queryOptions: { filter: `PartitionKey eq 'episodes'` } })) {
    episodes.push(entity);
  }

  episodes.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));

  const itemsXml = episodes.map(ep => `
    <item>
      <title>Top Reddit Threads for ${ep.rowKey}</title>
      <itunes:summary><![CDATA[${ep.summary}]]></itunes:summary>
      <description><![CDATA[${ep.summary}]]></description>
      <pubDate>${new Date(ep.createdOn).toUTCString()}</pubDate>
      <guid isPermaLink="false">${ep.rowKey}</guid>
      <enclosure url="${ep.audioUrl}" type="audio/x-wav" />
    </item>`).join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Reddit Top Threads</title>
    <link>https://yourdomain.com</link>
    <description>Daily AI-narrated podcast of top Reddit threads.</description>
    <language>en-us</language>
    <itunes:author>Reddit2Podcast AI</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="https://yourcdn.com/logo.png" />
    <itunes:category text="Technology" />
    ${itemsXml}
  </channel>
</rss>`;

  await uploadBufferToPublicBlob(Buffer.from(rssXml, 'utf-8'), 'rss/feed.xml', 'application/rss+xml');
}