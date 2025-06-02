const { moderateThread } = require('../moderator');
const { uploadJsonToBlobStorage } = require('../shared/storageUtil');

module.exports.moderateThreads = async function moderateThreads(input, context) {

  if (context.env === 'TEST' && context.skip?.cleanThreads) {
    const path = require('path');
    const threadsFile = require(path.join(process.cwd(), 'src/data/cleanThreads.json'));
    //return if threads is not empty
    if (threadsFile?.length > 0) {
      return { cleanThreads: threadsFile };
    }
  }
  const cleanThreads = await Promise.all(
    input.threads.map(thread => moderateThread(thread, context))
  );

  if(context.env === 'TEST') return {cleanThreads, jsonUrl: ''};
   
  const jsonUrl = await uploadJsonToBlobStorage(cleanThreads, `json/episode-${input.episodeId}.threads.json`);

  return {cleanThreads, jsonUrl};
}