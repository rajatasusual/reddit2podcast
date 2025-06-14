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
  const entities = await Promise.all(
    input.threads.map(thread => {
      try {
        const document = {
          id: input.episodeId,
          content: thread.comments
        }
        return entityExtraction(document, context);
      } catch (err) {
        context.log(`Error extracting entities from thread: ${err.message}`);
        return null;
      }
    }).filter(t => t !== null)
  );

  if(context.env === 'TEST') return {entities, jsonUrl: ''};
   
  const jsonUrl = await uploadJsonToBlobStorage(entities, `json/episode-${input.episodeId}.entities.json`);

  return {entities, jsonUrl};
}