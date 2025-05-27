const { app } = require('@azure/functions');

const {
  getTopThreads,
  moderateThreads,
  generateSSMLEpisode,
  synthesizeSSMLChunks,
  uploadArtifact,
  saveEpisodeMetadata,
  generateRSSFeed
} = require('./activities')

async function reddit2podcast(context) {
  try {
    const subreddit = 'technology';
    const episodeId = new Date().toISOString().split('T')[0];

    const threads = await getTopThreads(subreddit, context);
    const cleanThreads = await moderateThreads(threads, context);

    const { ssmlChunks, summary } = await generateSSMLEpisode(cleanThreads, context);
    const audioBuffer = await synthesizeSSMLChunks(ssmlChunks, context);

    const { jsonUrl, ssmlUrl, audioUrl } = await uploadArtifact({ cleanThreads, episodeId, ssmlChunks, audioBuffer }, context);

    await saveEpisodeMetadata({
      episodeId,
      subreddit,
      audioUrl,
      jsonUrl,
      ssmlUrl,
      summary
    }, context);
    await generateRSSFeed();

    context.log(`Episode metadata saved and RSS feed generated.. Audio URL: ${audioUrl}`);
  } catch (err) {
    context.log('Error generating podcast:', err);
  }
}

app.timer('scraper', {
  schedule: '0 0 0 * * *',
  handler: async (timer, context) => {
    context.log('Timer function triggered: Starting Reddit podcast scrape.');
    await reddit2podcast(context);
  }
});

module.exports = {
  reddit2podcast
};