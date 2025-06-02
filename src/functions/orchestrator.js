const { app } = require('@azure/functions');
const df = require('durable-functions');

df.app.orchestration('orchestrator', function* (context) {
  const subreddit = 'technology';
  const episodeId = context.df.currentUtcDateTime.toISOString().split('T')[0];

  // 1. Get top threads from subreddit
  const threads = yield context.df.callActivity("getTopThreads", {subreddit});

  // 2. Moderate threads
  const {cleanThreads, jsonUrl} = yield context.df.callActivity("moderateThreads", {threads, episodeId});

  // 3. Generate SSML
  const { ssmlChunks, summary, ssmlUrl } = yield context.df.callActivity("generateSSMLEpisode", { threads: cleanThreads, episodeId });

  // 4. Synthesize audio
  const {audioUrl, transcriptsUrl} = yield context.df.callActivity("synthesizeSSMLChunks", {ssmlChunks, episodeId});

  // 5. Save metadata
  const metadata = {
    episodeId,
    subreddit,
    audioUrl,
    jsonUrl,
    ssmlUrl,
    summary,
    transcriptsUrl
  };
  yield context.df.callActivity("saveEpisodeMetadata", metadata);

  // 6. Generate RSS feed
  yield context.df.callActivity("generateRSSFeed");

  return {
    message: `🎧 Episode created successfully`,
    audioUrl
  };
});

app.timer('startRedditPodcast', {
  schedule: '0 0 0 * * *',
  extraInputs: [df.input.durableClient()], 
  handler: async (myTimer, context) => {
    const client = df.getClient(context);
    await client.startNew('orchestrator', undefined);
    context.log("Orchestration started for Reddit2Podcast");
  }
});