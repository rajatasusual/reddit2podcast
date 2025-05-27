const { uploadJsonToBlobStorage, uploadXmlToBlobStorage, uploadAudioToBlobStorage } = require('../shared/storageUtil');

function combineSsmlChunks(ssmlChunks) {
  const stripSpeakTags = (ssml) => {
    return ssml
      .replace(/^<speak[^>]*>/, '')   // Remove opening <speak ...>
      .replace(/<\/speak>$/, '');     // Remove closing </speak>
  };

  const combinedContent = ssmlChunks.map(stripSpeakTags).join('\n');

  const finalSsml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
${combinedContent}
</speak>`;

  return finalSsml;
}
module.exports.uploadArtifact = async function uploadArtifact(artifact, context) {

  context.log('Uploading artifacts...');
  
  const jsonUrl = await uploadJsonToBlobStorage(artifact.cleanThreads, `json/episode-${artifact.episodeId}.threads.json`);
  const ssmlUrl = await uploadXmlToBlobStorage(combineSsmlChunks(artifact.ssmlChunks), `xml/episode-${artifact.episodeId}.ssml.xml`);
  const audioUrl = await uploadAudioToBlobStorage(artifact.audioBuffer, `audio/episode-${artifact.episodeId}.wav`);

  context.log('Artifacts uploaded.');

  return { jsonUrl, ssmlUrl, audioUrl };
}