const { moderateThread } = require('../moderator');
const { uploadJsonToBlobStorage } = require('../shared/storageUtil');

module.exports.moderateThreads = async function moderateThreads(input, context) {
  const cleanThreads = await Promise.all(
    input.threads.map(thread => moderateThread(thread, context))
  );

  const jsonUrl = await uploadJsonToBlobStorage(cleanThreads, `json/episode-${input.episodeId}.threads.json`);

  return {cleanThreads, jsonUrl};
}