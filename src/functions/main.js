const { app } = require('@azure/functions');

const {
  getTopThreads,
  moderateThreads,
  generateSSMLEpisode,
  synthesizeSSMLChunks,
  saveEpisodeMetadata,
  generateRSSFeed
} = require('./activities')

async function reddit2podcast(context) {
  try {
    const subreddit = 'technology';
    const episodeId = new Date().toISOString().split('T')[0];

    const threads = await getTopThreads({ subreddit }, context);
    const { cleanThreads, jsonUrl } = await moderateThreads({ threads, episodeId }, context);

    const { ssmlChunks, summary, ssmlUrl } = await generateSSMLEpisode({ threads: cleanThreads, episodeId }, context);
    const audioUrl = await synthesizeSSMLChunks({ ssmlChunks, episodeId }, context);

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

module.exports = {
  reddit2podcast
};