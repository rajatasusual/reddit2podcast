const { uploadXmlToBlobStorage } = require('../shared/storageUtil');
const { extractiveSummarization, abstractiveSummarization } = require('../summarizer');

function wrapSsmlBlock(content) {
  return `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
      xmlns:mstts="http://www.w3.org/2001/mstts"
      xml:lang="en-US">${content}</speak>`;
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

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&apos;',
    '"': '&quot;'
  })[c]);
}

module.exports.generateSSMLEpisode = async function generateSSMLEpisode(input, context) {
  const hostVoice = "en-US-GuyNeural";
  const commenterVoice = "en-US-JennyNeural";

  const ssmlChunks = [];

  context.log(`Generating SSML for ${input.threads.length} threads.`);

  // Intro
  ssmlChunks.push(wrapSsmlBlock(`
    <voice name="${hostVoice}">
      <mstts:express-as style="cheerful">
        <s>Welcome to today's episode of Reddit Top Threads.</s>
        <s>Let's dive in!</s>
      </mstts:express-as>
    </voice>`));

  // Summary
  const documents = input.threads.map(thread => `${thread.title} ${thread.comments.join(' ')}`);

  const summary = await extractiveSummarization(documents, context);
  ssmlChunks.push(wrapSsmlBlock(`
    <voice name="${hostVoice}">
      <mstts:express-as style="narration-professional">
        <s>${escapeXml(summary)}</s>
      </mstts:express-as>
    </voice>`));

  // Threads
  for (let idx = 0; idx < input.threads.length; idx++) {
    const thread = input.threads[idx];
    const threadSsmlParts = [];

    threadSsmlParts.push(`
      <voice name="${hostVoice}">
        <mstts:express-as style="newscast-casual">
          <s>Thread ${idx + 1}: ${escapeXml(thread.title)}</s>
        </mstts:express-as>
      </voice>`);

    // Summarize thread content
    const threadContent = `Excerpt fromReddit thread titled: ${thread.title} ${thread.content} ${thread.comments.join('.')}`;
    const threadSummary = await abstractiveSummarization([threadContent], context);
    context.log(`Thread ${idx + 1} summary complete.`);

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

    const ssmlUrl = await uploadXmlToBlobStorage(combineSsmlChunks(ssmlChunks), `xml/episode-${input.episodeId}.ssml.xml`);

  return { ssmlChunks, summary, ssmlUrl };
}