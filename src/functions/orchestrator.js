const { app } = require('@azure/functions');
const df = require('durable-functions');

df.app.orchestration('orchestrator', function* (context) {
  // 0. Get list of subreddits
  const subreddits = yield context.df.callActivity("getTopSubreddits");
  
  const results = [];
  
  for (const subreddit of subreddits) {
    const episodeId = `${context.df.currentUtcDateTime.toISOString().split('T')[0]}_${subreddit}`;
    
    // 1. Get top threads
    const threads = yield context.df.callActivity("getTopThreads", { subreddit });

    // 2. Moderate threads
    const { cleanThreads, jsonUrl } = yield context.df.callActivity("moderateThreads", { threads, episodeId });

    // 3. Generate content analysis
    const contentAnalysis = yield context.df.callActivity("generateContentAnalysis", { threads: cleanThreads });

    // 4. Generate SSML
    const { ssmlChunks, summary, ssmlUrl } = yield context.df.callActivity("generateSSMLEpisode", { 
      threads: cleanThreads, 
      episodeId,
      contentAnalysis
    });

    // 5. Synthesize audio
    const { audioUrl, transcriptsUrl } = yield context.df.callActivity("synthesizeSSMLChunks", { ssmlChunks, episodeId });

    // 6. Save metadata
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
    
    results.push({ subreddit, audioUrl });
  }

  // 7. Generate RSS feed after all subreddits
  yield context.df.callActivity("generateRSSFeed");

  return {
    message: `Processed ${subreddits.length} subreddits`,
    results
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