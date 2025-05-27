const removeMd = require('remove-markdown');
const snoowrap = require('snoowrap');

module.exports.getTopThreads = async function getTopThreads(subreddit, context) {
  const r = new snoowrap({
    userAgent: 'RedditToPodcast v1.0',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
  });

  context.log(`Fetching top threads from ${subreddit}`);

  const posts = await r.getSubreddit(subreddit).getTop({ time: 'day', limit: 5 });

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

  context.log(`Fetched ${threads.length} threads from ${subreddit}`);

  return threads;
}