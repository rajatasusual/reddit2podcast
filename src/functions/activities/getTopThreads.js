const removeMd = require('remove-markdown');
const snoowrap = require('snoowrap');
const { getSecretClient } = require('../shared/keyVault');

module.exports.getTopThreads = async function getTopThreads(input, context) {

  if (context.env === 'TEST' && context.skip?.threads) {
    const path = require('path');
    const threadsFile = require(path.join(process.cwd(), 'src/data/threads.json'));
    if (threadsFile?.length > 0) {
      return { threads: threadsFile };
    }
  }

  const secretClient = getSecretClient();

  const REDDIT_CLIENT_ID = context.env === 'TEST' ? process.env.REDDIT_CLIENT_ID : (await secretClient.getSecret("REDDIT-CLIENT-ID")).value;
  const REDDIT_CLIENT_SECRET = context.env === 'TEST' ? process.env.REDDIT_CLIENT_SECRET : (await secretClient.getSecret("REDDIT-CLIENT-SECRET")).value;
  const REDDIT_USERNAME = context.env === 'TEST' ? process.env.REDDIT_USERNAME : (await secretClient.getSecret("REDDIT-USERNAME")).value;
  const REDDIT_PASSWORD = context.env === 'TEST' ? process.env.REDDIT_PASSWORD : (await secretClient.getSecret("REDDIT-PASSWORD")).value;

  const r = new snoowrap({
    userAgent: 'RedditToPodcast v1.0',
    clientId: REDDIT_CLIENT_ID,
    clientSecret: REDDIT_CLIENT_SECRET,
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD
  });

  context.log(`Fetching top threads from ${input.subreddit}`);

  const posts = await r.getSubreddit(input.subreddit).getTop({ time: 'day', limit: 5 });

  const threads = await Promise.all(posts.map(async (post) => {
    const fullPost = await r.getSubmission(post.id).expandReplies({ limit: 3, depth: 1 });
    const comments = fullPost.comments
      .filter(c => c.body)
      .slice(0, 3)
      .map(c => removeMd(c.body));

    return {
      title: fullPost.title,
      author: fullPost.author.name,
      content: removeMd(fullPost.selftext || ''),
      comments,
      permalink: fullPost.permalink,
      url: fullPost.url
    };
  }));

  context.log(`Fetched ${threads.length} threads from ${input.subreddit}`);

  return threads;
}