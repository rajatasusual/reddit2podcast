const { moderateThread } = require('../moderator');

module.exports.moderateThreads = async function moderateThreads(threads, context) {
  const cleanedThreads = await Promise.all(
    threads.map(thread => moderateThread(thread, context))
  );

  return cleanedThreads;
}