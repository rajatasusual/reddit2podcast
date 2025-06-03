const { uploadXmlToBlobStorage } = require('../shared/storageUtil');
const { extractiveSummarization, abstractiveSummarization } = require('../summarizer');

const voiceConfig = {
  host: {
    name: "en-US-BrianNeural",
    personality: "professional-friendly",
    defaultStyle: "newscast-casual"
  },
  commenters: [
    { name: "en-US-MichelleNeural", personality: "enthusiastic", style: "cheerful" },
    { name: "en-US-JennyNeural", personality: "analytical", style: "calm" },
    { name: "en-US-AmberNeural", personality: "conversational", style: "friendly" },
    { name: "en-US-EmmaNeural", personality: "dramatic", style: "excited" },
    { name: "en-US-AvaNeural", personality: "soothing", style: "gentle" }
  ]
};

function escapeXml(text) {
  return text ? text.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])) : '';
}

function wrapSsmlBlock(content) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">${content}</speak>`;
}

function combineSsmlChunks(ssmlChunks) {
  const stripTags = ssml => ssml.replace(/^<speak[^>]*>/, '').replace(/<\/speak>$/, '');
  const combined = ssmlChunks.map(stripTags).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?><speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">${combined}</speak>`;
}

function generateDynamicSSML(content, voiceName, style, sentiment, intensity, additional = {}) {
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  // Normalize intensity to 1–10 scale
  const normalizedIntensity = clamp(intensity || 5, 1, 10);

  // Contextual rate based on sentiment and intensity
  const rate = (() => {
    if (sentiment === 'positive') {
      return normalizedIntensity > 7 ? 'fast' : 'medium';
    } else {
      return 'medium';
    }
  })();

  // Contextual volume based on sentiment and intensity
  const volume = (() => {
    if (sentiment === 'positive') {
      return normalizedIntensity > 7 ? 'x-loud' : normalizedIntensity > 4 ? 'loud' : 'medium';
    } else if (sentiment === 'negative') {
      return normalizedIntensity < 4 ? 'soft' : 'medium';
    } else {
      return normalizedIntensity > 6 ? 'loud' : 'medium';
    }
  })();

  const pitch = sentiment === "positive" ? "+10%" : sentiment === "negative" ? "-10%" : "medium";

  return `<voice name="${voiceName}"><mstts:express-as style="${style}"${additional.degree ? ` styledegree="${additional.degree}"` : ''}><prosody rate="${rate}" volume="${volume}" pitch="${pitch}">${content}</prosody></mstts:express-as></voice>`;
}


function createConversationalTransition(transitionPhrase) {
  const transitions = ["Now, here's something completely different", "Speaking of which, this next one really caught my eye", "On a related note", "This next discussion takes an interesting turn", "Now for something that sparked quite the debate"];
  return escapeXml(transitionPhrase || transitions[Math.floor(Math.random() * transitions.length)]);
}

module.exports.generateSSMLEpisode = async function generateSSMLEpisode(input, context) {

  if (context.env === 'TEST' && context.skip?.ssml) {
    const path = require('path');
    const fs = require('fs');
    const ssmlChunksFile = fs.readFileSync(path.join(process.cwd(), 'src/data/ssmlChunks.txt'), 'utf-8');
    if (ssmlChunksFile) {
      const ssmlChunks = ssmlChunksFile.split('{{CHUNKS}}');
      return { ssmlChunks };
    }
  }

  const ssmlChunks = [];
  context.log(`Analyzing content with Perplexity for ${input.threads.length} threads.`);
  const contentAnalysis = input.contentAnalysis;

  const introHook = contentAnalysis.conversationalHooks?.intro;
  const introContent = introHook
    ? `<s>Welcome to today's episode of Reddit Top Threads.</s><s><break time="300ms"/></s>
       <s>${escapeXml(introHook.hook)}.</s><s><break time="500ms"/></s>
       <s>We've got ${input.threads.length} fascinating discussions to explore today, 
          covering themes like ${escapeXml(contentAnalysis.keyThemes.join(', '))}.</s>`
    : `<s>Welcome to today's episode of Reddit Top Threads.</s>
       <s>Let's dive into today's most engaging discussions!</s>`;

  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(introContent, voiceConfig.host.name, "cheerful", "positive", 6, { degree: "2" })));

  const docs = input.threads.map(t => `${t.title}\n${t.comments.join('\n')}`);
  const summary = await extractiveSummarization(docs, context);
  const summarySentences = summary.split(/\r?\n/).map(s => `<s>${escapeXml(s)}</s>`).join('<s><break time="500ms"/></s>');
  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(`<s>Here's what we're covering today:</s>${summarySentences}<s>Let's get started!</s>`, voiceConfig.host.name, "narration-professional", "neutral", 5)));

  for (let idx = 0; idx < input.threads.length; idx++) {
    const t = input.threads[idx];
    const a = contentAnalysis.threadAnalysis[idx] || {};
    const parts = [];

    if (idx > 0) parts.push(generateDynamicSSML(createConversationalTransition(a?.transitionPhrase), voiceConfig.host.name, "newscast-casual", "neutral", 4));

    const emph = a.emotionalIntensity > 7 ? "strong" : "moderate";
    parts.push(generateDynamicSSML(`<s><emphasis level=\"${emph}\">Thread ${idx + 1}:</emphasis> ${escapeXml(t.title)}</s>`, voiceConfig.host.name, a.suggestedVoiceStyle || "newscast-casual", a.sentiment || "neutral", a.emotionalIntensity || 5));

    const summary = await abstractiveSummarization([`${t.title} ${t.content} ${t.comments.join('.')}`], context);
    parts.push(generateDynamicSSML(`<s>${escapeXml(summary)}</s><s>${escapeXml(a.hostCommentary || 'This generated quite a discussion.')}</s>`, voiceConfig.host.name, "narration-professional", a.sentiment || "neutral", Math.min(6, (a.emotionalIntensity || 5) + 1)));

    if (t.comments?.length) {
      parts.push(generateDynamicSSML(`<s>Let's hear what the community had to say:</s>`, voiceConfig.host.name, "friendly", "positive", 5));
      t.comments.slice(0, 4).forEach((c, i) => {
        const v = voiceConfig.commenters[i % voiceConfig.commenters.length];
        parts.push(generateDynamicSSML(`<s>${escapeXml(c)}</s>`, v.name, v.style, a.sentiment || "neutral", Math.max(3, (a.emotionalIntensity || 5) - 1)));
      });
    }

    ssmlChunks.push(wrapSsmlBlock(parts.join('\n')));
  }

  const outroHook = contentAnalysis.conversationalHooks?.conclusion;
  const outroContent = outroHook
    ? `<s>${escapeXml(outroHook.hook)}</s><s>Thanks for joining!</s>`
    : `<s>Thanks for listening, and we'll see you next time!</s>`;

  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(outroContent, voiceConfig.host.name, "cheerful", "positive", 6, { degree: "2" })));

  if (context.env === 'TEST') {
    return { ssmlChunks, summary, contentAnalysis, ssmlUrl: '' };
  }

  const finalSsml = combineSsmlChunks(ssmlChunks);
  const ssmlUrl = await uploadXmlToBlobStorage(finalSsml, `xml/episode-${input.episodeId}.ssml.xml`);

  return { ssmlChunks, summary, contentAnalysis, ssmlUrl };
};
