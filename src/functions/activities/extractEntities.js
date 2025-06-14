const { entityExtraction } = require('../extractor');
const { uploadJsonToBlobStorage } = require('../shared/storageUtil');

module.exports.extractEntities = async function extractEntities(input, context) {

  if (context.env === 'TEST' && context.skip?.extractEntities) {
    const path = require('path');
    const entitiesFile = require(path.join(process.cwd(), 'src/data/entities.json'));
    //return if threads is not empty
    if (entitiesFile?.length > 0) {
      return { entities: entitiesFile };
    }
  }

  const episodeId = input.episodeId;

  console.log(`Extracting entities for episode: ${episodeId}`);

  const promises = input.threads.map(thread => [
    entityExtraction({
      content: [thread.title + thread.content],
      id: episodeId,
      metadata: {
        title: thread.title,
        permalink: thread.permalink,
        url: thread.url,
        author: thread.author
      }
    }, context),
    entityExtraction({
      content: thread.comments,
      id: episodeId,
    }, context)
  ]);

  const entities = await Promise.all(promises.flat());

  console.log(`Processed entities for episode: ${episodeId}`);

  if (context.env === 'TEST') return { entities, jsonUrl: '' };

  const jsonUrl = await uploadJsonToBlobStorage(entities, `json/episode-${episodeId}.entities.json`);

  return { entities, jsonUrl };
}