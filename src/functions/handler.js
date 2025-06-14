const df = require('durable-functions');

const {
  getTopSubreddits,
  getTopThreads,
  moderateThreads,
  generateContentAnalysis,
  generateSSMLEpisode,
  synthesizeSSMLChunks,
  saveEpisodeMetadata,
  generateRSSFeed,
  extractEntities
} = require('./activities')

df.app.activity('getTopSubreddits', {
  handler: async (_, context) => {
    return await getTopSubreddits(context);
  }
});

df.app.activity('getTopThreads', {
  handler: async (input, context) => {
    return await getTopThreads(input, context);
  }
});

df.app.activity('moderateThreads', {
  handler: async (input, context) => {
    return await moderateThreads(input, context);
  }
});

df.app.activity('generateContentAnalysis', {
  handler: async (input, context) => {
    return await generateContentAnalysis(input, context);
  }
});

df.app.activity('generateSSMLEpisode', {
  handler: async (input, context) => {
    return await generateSSMLEpisode(input, context);
  }
});

df.app.activity('synthesizeSSMLChunks', {
  handler: async (input, context) => {
    return await synthesizeSSMLChunks(input, context);
  }
});

df.app.activity('saveEpisodeMetadata', {
  handler: async (input, context) => {
    return await saveEpisodeMetadata(input, context);
  }
});

df.app.activity('extractEntities', {
  handler: async (input, context) => {
    return await extractEntities(input, context);
  }
});

df.app.activity('generateRSSFeed', {
  handler: async (input, context) => {
    return await generateRSSFeed(input, context);
  }
});