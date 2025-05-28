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
    fs.writeFileSync(path.join(dataDir, 'threads.json'), JSON.stringify(threads, null, 2));

    const { cleanThreads } = await moderateThreads({ threads }, context);
    fs.writeFileSync(path.join(dataDir, 'cleanThreads.json'), JSON.stringify(cleanThreads, null, 2));

    const { ssmlChunks } = await generateSSMLEpisode({ threads: cleanThreads }, context);
    fs.writeFileSync(path.join(dataDir, 'ssml.xml'), ssmlChunks.join('\n'));

    const audioBuffer = await synthesizeSSMLChunks({ ssmlChunks }, context);
    fs.writeFileSync(path.join(dataDir, 'audio.mp3'), audioBuffer);
    
    context.log('Podcast generation complete.');
  } catch (err) {
    context.log('Error generating podcast:', err);
  }
}

module.exports = {
  reddit2podcast
};

