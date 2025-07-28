const {
  getTopSubreddits,
  getTopThreads,
  moderateThreads,
  generateContentAnalysis,
  generateSSMLEpisode,
  synthesizeSSMLChunks,
  extractEntities
} = require('./activities')

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

async function reddit2podcast(context) {
  try {
    const subreddits = await getTopSubreddits(context);

    const dataDir = path.join(__dirname, `../data`);
    mkdirp.sync(dataDir);

    for (const subreddit of subreddits) {
      try {
        const dataSubredditDir = path.join(dataDir, subreddit);
        mkdirp.sync(dataSubredditDir);

        const threads = await getTopThreads({ subreddit }, context);
        if (!context.skip?.threads) fs.writeFileSync(path.join(dataSubredditDir, `threads.json`), JSON.stringify(threads, null, 2));

        const { cleanThreads } = await moderateThreads({ threads, subreddit }, context);
        if (!context.skip?.cleanThreads) fs.writeFileSync(path.join(dataSubredditDir, `cleanThreads.json`), JSON.stringify(cleanThreads, null, 2));

        const contentAnalysis = await generateContentAnalysis({ threads: cleanThreads, subreddit }, context);
        if (!context.skip?.contentAnalysis) fs.writeFileSync(path.join(dataSubredditDir, `contentAnalysis.json`), JSON.stringify(contentAnalysis, null, 2));

        const { ssmlChunks } = await generateSSMLEpisode({ threads: cleanThreads, contentAnalysis,subreddit }, context);
        if (!context.skip?.ssml) {
          fs.writeFileSync(path.join(dataSubredditDir, `ssmlChunks.txt`), ssmlChunks.join('{{CHUNKS}}'));
          fs.writeFileSync(path.join(dataSubredditDir, `contentAnalysis.json`), JSON.stringify(contentAnalysis, null, 2));
        }
        const { mergedAudio, fullTranscript } = await synthesizeSSMLChunks({ ssmlChunks, subreddit }, context);
        if (!context.skip?.synthesis) {
          fs.writeFileSync(path.join(dataSubredditDir, `audio.wav`), mergedAudio);
          fs.writeFileSync(path.join(dataSubredditDir, `transcript.json`), JSON.stringify(fullTranscript, null, 2));
        }

        context.log(`Podcast generation complete for ${subreddit}`);
        
        const { entities } = await extractEntities({ threads: cleanThreads, episodeId: subreddit, subreddit }, context);
        if (!context.skip?.extractEntities) fs.writeFileSync(path.join(dataSubredditDir, `entities.json`), JSON.stringify(entities, null, 2));

      } catch (err) {
        context.log(`Error generating podcast for ${subreddit}:`, err);
      } finally {
        if (context.skip?.breakafterone) break;
      }
    }
  } catch (err) {
    context.log('Error generating podcast:', err);
  }
}

module.exports = {
  reddit2podcast
};

