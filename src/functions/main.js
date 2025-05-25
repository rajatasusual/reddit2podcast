const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

const removeMd = require('remove-markdown');
const snoowrap = require('snoowrap');
const sdk = require("microsoft-cognitiveservices-speech-sdk");

const { extractiveSummarization } = require('./summarizer');

// --- Azure Cognitive Services setup ---
const speechKey = process.env.AZURE_SPEECH_KEY;
const speechRegion = process.env.AZURE_SPEECH_REGION;

const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm; // WAV PCM

// --- Blob Storage setup ---
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(`${process.env.AZURE_STORAGE_ACCOUNT}-audio`);

// --- Helpers ---

// Escape XML special chars for safe SSML embedding
function escapeXml(text) {
  return text.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&apos;',
    '"': '&quot;'
  })[c]);
}

// Synthesize speech from SSML
async function synthesizeSpeechSsml(ssml) {
  return new Promise((resolve, reject) => {
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    synthesizer.speakSsmlAsync(
      ssml,
      result => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error('Speech synthesis failed'));
        }
        synthesizer.close();
      },
      error => {
        synthesizer.close();
        reject(error);
      }
    );
  });
}

async function generateSsmlEpisode(threads, context) {
  const hostVoice = "en-US-GuyNeural";
  const commenterVoice = "en-US-JennyNeural";

  context.log(`Generating SSML for ${threads.length} threads`);

  let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">`;

  // Episode Intro
  ssml += `<voice name="${hostVoice}"><p>Welcome to today's episode of Reddit Top Threads. Let's dive in!<break time="1s"/></p></voice>`;

  //convert threads into documents with titles and comments for summarizer
  const documents = threads.map(thread => `${thread.title} ${thread.comments.join(' ')}`);

  // Summarize the documents
  context.log("Summarizing documents...");
  const summary = await extractiveSummarization(documents, context);
  context.log("Summarization complete.");

  // Add the summary to the SSML
  ssml += `<voice name="${hostVoice}"><p>${escapeXml(summary)}</p></voice>`;

  threads.forEach((thread, idx) => {
    context.log(`Synthesizing SSML for thread: ${thread.title}`);

    ssml += `<voice name="${hostVoice}"><p>Thread ${idx + 1}: ${escapeXml(thread.title)}<break time="300ms"/></p></voice>`;
    thread.comments.forEach((comment, i) => {
      ssml += `<voice name="${commenterVoice}"><p>Commenter ${i + 1} says: ${escapeXml(comment)}<break time="500ms"/></p></voice>`;
    });

    if (idx < threads.length - 1) {
      ssml += `<voice name="${hostVoice}"><p>And now, moving on to the next hot topic.<break time="1s"/></p></voice>`;
    }
  });

  // Outro
  ssml += `<voice name="${hostVoice}"><p>That wraps up our episode. Thanks for listening!<break time="1s"/></p></voice>`;
  ssml += `</speak>`;
  
  return { ssml, summary };
}

async function uploadBufferToBlob(buffer, filename, contentType = "application/octet-stream") {
  await containerClient.createIfNotExists();
  const blockBlobClient = containerClient.getBlockBlobClient(filename);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType }
  });
  return blockBlobClient.url;
}

async function uploadXmlToBlobStorage(xmlString, filename) {
  const buffer = Buffer.from(xmlString, 'utf-8');
  return await uploadBufferToBlob(buffer, filename, 'application/xml');
}

async function uploadJsonToBlobStorage(jsonString, filename) {
  const buffer = Buffer.from(jsonString, 'utf-8');
  return await uploadBufferToBlob(buffer, filename, 'application/json');
}


async function uploadAudioToBlobStorage(buffer, filename) {
  return await uploadBufferToBlob(buffer, filename, 'audio/x-wav');
}

async function getTopThreads(subreddit) {
  const r = new snoowrap({
    userAgent: 'RedditToPodcast v1.0',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
  });

  const posts = await r.getSubreddit(subreddit).getTop({ time: 'day', limit: 5 });

  const threads = [];

  for (const post of posts) {
    const fullPost = await r.getSubmission(post.id);
    const expandedPost = await fullPost.expandReplies({ limit: 3, depth: 1 });

    const comments = expandedPost.comments
      .filter(comment => comment.body) // Ensure the comment has a body
      .slice(0, 3)
      .map(comment => removeMd(comment.body));

    threads.push({
      title: expandedPost.title,
      author: expandedPost.author.name,
      content: removeMd(expandedPost.selftext || ''),
      comments,
      permalink: expandedPost.permalink,
      url: expandedPost.url
    });
  }

  return threads;
}



async function saveEpisodeMetadata(metadata) {

  const tableName = "PodcastEpisodes";
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCOUNT_KEY)
  );

  await tableClient.createTable(); // Creates only if not exists

  const entity = {
    partitionKey: "episodes",
    rowKey: metadata.episodeId,
    subreddit: metadata.subreddit,
    audioUrl: metadata.audioUrl,
    jsonUrl: metadata.jsonUrl,
    ssmlUrl: metadata.ssmlUrl,
    createdOn: new Date().toISOString(),
    summary: metadata.summary
  };

  await tableClient.upsertEntity(entity);
}


async function reddit2podcast(context) {
  try {
    const subreddit = 'technology';
    const episodeId = new Date().toISOString().split('T')[0];

    const threads = await getTopThreads(subreddit);
    const jsonUrl = await uploadJsonToBlobStorage(threads, `json/episode-${episodeId}.threads.json`);

    const { ssml, summary } = await generateSsmlEpisode(threads, context);
    const ssmlUrl = await uploadXmlToBlobStorage(ssml, `xml/episode-${episodeId}.ssml.xml`);

    const audioBuffer = await synthesizeSpeechSsml(ssml);
    const audioUrl = await uploadAudioToBlobStorage(audioBuffer, `audio/episode-${episodeId}.wav`);

    await saveEpisodeMetadata({
      episodeId,
      subreddit,
      audioUrl,
      jsonUrl,
      ssmlUrl,
      summary
    });

    context.log(`Episode metadata saved. Audio URL: ${audioUrl}`);
  } catch (err) {
    context.log('Error generating podcast:', err);
  }
}

app.timer('scraper', {
  schedule: '0 0 0 * * *',
  handler: async (timer, context) => {
    context.log('Timer function triggered: Starting Reddit podcast scrape.');
    await reddit2podcast(context);
  }
});

module.exports = {
  reddit2podcast
};