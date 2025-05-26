const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { TableClient, AzureNamedKeyCredential } = require('@azure/data-tables');

const removeMd = require('remove-markdown');
const snoowrap = require('snoowrap');
const sdk = require("microsoft-cognitiveservices-speech-sdk");

const { extractiveSummarization, abstractiveSummarization } = require('./summarizer');

const { moderateThread } = require('./moderator');

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

function wrapSsmlBlock(content) {
  return `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
      xmlns:mstts="http://www.w3.org/2001/mstts"
      xml:lang="en-US">${content}</speak>`;
}
function mergeWavBuffers(buffers) {
  const HEADER_SIZE = 44;

  const firstHeader = buffers[0].slice(0, HEADER_SIZE);
  const audioDataBuffers = buffers.map(buf => buf.slice(HEADER_SIZE));
  const totalAudioDataLength = audioDataBuffers.reduce((sum, b) => sum + b.length, 0);

  const mergedBuffer = Buffer.alloc(HEADER_SIZE + totalAudioDataLength);
  firstHeader.copy(mergedBuffer, 0);

  // Write correct file size and data length in header
  mergedBuffer.writeUInt32LE(36 + totalAudioDataLength, 4);  // File size = 36 + data
  mergedBuffer.writeUInt32LE(totalAudioDataLength, 40);      // Subchunk2Size

  let offset = HEADER_SIZE;
  for (const audioBuf of audioDataBuffers) {
    audioBuf.copy(mergedBuffer, offset);
    offset += audioBuf.length;
  }

  return mergedBuffer;
}

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

// Synthesize speech from SSML
async function synthesizeSsmlChunks(ssmlChunks, context) {
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

  const synthesizeChunk = async (ssml, index) => {
    context.log(`🔊 Synthesizing chunk ${index + 1}/${ssmlChunks.length}...`);
    return new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        result => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({ index, buffer: Buffer.from(result.audioData) });
          } else {
            reject(new Error(`Synthesis failed: ${result.errorDetails}`));
            synthesizer.close();
          }
        },
        error => reject(error)
      );
    });
  };

  const results = await Promise.all(ssmlChunks.map((ssml, i) => synthesizeChunk(ssml, i)));

  synthesizer.close();

  // Sort buffers by their original index to ensure they are combined in order
  const buffers = results.sort((a, b) => a.index - b.index).map(result => result.buffer);

  return mergeWavBuffers(buffers);
}

async function generateSsmlEpisode(threads, context) {
  const hostVoice = "en-US-GuyNeural";
  const commenterVoice = "en-US-JennyNeural";

  const ssmlChunks = [];

  // Intro
  ssmlChunks.push(wrapSsmlBlock(`
    <voice name="${hostVoice}">
      <mstts:express-as style="cheerful">
        <s>Welcome to today's episode of Reddit Top Threads.</s>
        <s>Let's dive in!</s>
      </mstts:express-as>
    </voice>`));

  // Summary
  const documents = threads.map(thread => `${thread.title} ${thread.comments.join(' ')}`);

  const summary = await extractiveSummarization(documents, context);
  ssmlChunks.push(wrapSsmlBlock(`
    <voice name="${hostVoice}">
      <mstts:express-as style="narration-professional">
        <s>${escapeXml(summary)}</s>
      </mstts:express-as>
    </voice>`));

  // Threads
  for (let idx = 0; idx < threads.length; idx++) {
    const thread = threads[idx];
    const threadSsmlParts = [];

    threadSsmlParts.push(`
      <voice name="${hostVoice}">
        <mstts:express-as style="newscast-casual">
          <s>Thread ${idx + 1}: ${escapeXml(thread.title)}</s>
        </mstts:express-as>
      </voice>`);

    // Summarize thread content
    const threadContent = `Excerpt fromReddit thread titled: ${thread.title} ${thread.content} ${thread.comments.join('.')}`;
    context.log("Summarizing thread content...");
    const threadSummary = await abstractiveSummarization([threadContent], context);
    context.log("Thread summarization complete.");

    // Add summarized content to SSML
    threadSsmlParts.push(`
      <voice name="${hostVoice}">
        <mstts:express-as style="narration-professional">
          <prosody rate="medium">
            <s>${escapeXml(threadSummary)}<break time="300ms"/></s>
          </prosody>
        </mstts:express-as>
      </voice>
    `);

    thread.comments.forEach((comment, i) => {
      threadSsmlParts.push(`
        <voice name="${commenterVoice}">
          <mstts:express-as style="friendly">
            <s>Commenter ${i + 1} says: ${escapeXml(comment)}</s>
          </mstts:express-as>
        </voice>`);
    });

    ssmlChunks.push(wrapSsmlBlock(threadSsmlParts.join('\n')));
  }

  // Outro
  ssmlChunks.push(wrapSsmlBlock(`
    <voice name="${hostVoice}">
      <mstts:express-as style="cheerful">
        <s>That wraps up our episode.</s>
        <s>Thanks for listening!</s>
      </mstts:express-as>
    </voice>`));

  return { ssmlChunks, summary };
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

async function uploadJsonToBlobStorage(threads, filename) {
  const jsonString = JSON.stringify(threads, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');
  return await uploadBufferToBlob(buffer, filename, 'application/json');
}


async function uploadAudioToBlobStorage(buffer, filename) {
  return await uploadBufferToBlob(buffer, filename, 'audio/x-wav');
}

async function moderateThreads(threads, context) {
  const cleanedThreads = await Promise.all(
    threads.map(thread => moderateThread(thread, context))
  );

  return cleanedThreads;
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

async function generateRssFeed() {
  const tableClient = new TableClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    "PodcastEpisodes",
    new AzureNamedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCOUNT_KEY)
  );

  const episodes = [];
  for await (const entity of tableClient.listEntities({ queryOptions: { filter: `PartitionKey eq 'episodes'` } })) {
    episodes.push(entity);
  }

  episodes.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));

  const itemsXml = episodes.map(ep => `
    <item>
      <title>Top Reddit Threads for ${ep.rowKey}</title>
      <itunes:summary><![CDATA[${ep.summary}]]></itunes:summary>
      <description><![CDATA[${ep.summary}]]></description>
      <pubDate>${new Date(ep.createdOn).toUTCString()}</pubDate>
      <guid isPermaLink="false">${ep.rowKey}</guid>
      <enclosure url="${ep.audioUrl}" type="audio/x-wav" />
    </item>`).join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Reddit Top Threads</title>
    <link>https://yourdomain.com</link>
    <description>Daily AI-narrated podcast of top Reddit threads.</description>
    <language>en-us</language>
    <itunes:author>Reddit2Podcast AI</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="https://yourcdn.com/logo.png" />
    <itunes:category text="Technology" />
    ${itemsXml}
  </channel>
</rss>`;

  await uploadBufferToBlob(Buffer.from(rssXml, 'utf-8'), 'rss/feed.xml', 'application/rss+xml');
}

async function reddit2podcast(context) {
  try {
    const subreddit = 'technology';
    const episodeId = new Date().toISOString().split('T')[0];

    const threads = await getTopThreads(subreddit);
    const cleanThreads = await moderateThreads(threads, context);

    const { ssmlChunks, summary } = await generateSsmlEpisode(cleanThreads, context);
    const audioBuffer = await synthesizeSsmlChunks(ssmlChunks, context);

    const jsonUrl = await uploadJsonToBlobStorage(cleanThreads, `json/episode-${episodeId}.threads.json`);
    const ssmlUrl = await uploadXmlToBlobStorage(combineSsmlChunks(ssmlChunks), `xml/episode-${episodeId}.ssml.xml`);
    const audioUrl = await uploadAudioToBlobStorage(audioBuffer, `audio/episode-${episodeId}.wav`);

    await saveEpisodeMetadata({
      episodeId,
      subreddit,
      audioUrl,
      jsonUrl,
      ssmlUrl,
      summary
    });
    await generateRssFeed();

    context.log(`Episode metadata saved and RSS feed generated.. Audio URL: ${audioUrl}`);
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