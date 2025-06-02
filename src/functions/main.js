const {
  getTopThreads,
  moderateThreads,
  generateSSMLEpisode,
  synthesizeSSMLChunks,
} = require('./activities')

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

async function reddit2podcast(context) {
  try {
    const subreddit = 'technology';

    const dataDir = path.join(__dirname, `../data`);
    mkdirp.sync(dataDir);

    const threads = await getTopThreads({ subreddit }, context);
    if (!context.skip?.threads) fs.writeFileSync(path.join(dataDir, 'threads.json'), JSON.stringify(threads, null, 2));

    const { cleanThreads } = await moderateThreads({ threads }, context);
    if (!context.skip?.cleanThreads) fs.writeFileSync(path.join(dataDir, 'cleanThreads.json'), JSON.stringify(cleanThreads, null, 2));

    const { ssmlChunks, contentAnalysis } = await generateSSMLEpisode({ threads: cleanThreads }, context);
    if (!context.skip?.ssml) {
      fs.writeFileSync(path.join(dataDir, 'ssmlChunks.txt'), ssmlChunks.join('{{CHUNKS}}'));
      fs.writeFileSync(path.join(dataDir, 'contentAnalysis.json'), JSON.stringify(contentAnalysis, null, 2));
    }
    const { mergedAudio, fullTranscript } = await synthesizeSSMLChunks({ ssmlChunks }, context);
    if (!context.skip?.synthesis) {
      fs.writeFileSync(path.join(dataDir, 'audio.wav'), mergedAudio);
      fs.writeFileSync(path.join(dataDir, 'transcript.json'), JSON.stringify(fullTranscript, null, 2));
    } 

    context.log('Podcast generation complete.');
  } catch (err) {
    context.log('Error generating podcast:', err);
  }
}

module.exports = {
  reddit2podcast
};

