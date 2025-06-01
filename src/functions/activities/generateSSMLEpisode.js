const { uploadXmlToBlobStorage } = require('../shared/storageUtil');
const { extractiveSummarization, abstractiveSummarization } = require('../summarizer');
const { default: pRetry } = require('p-retry');

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai/chat/completions';

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

const contentAnalysisSchema = {
  type: "object",
  properties: {
    overallTone: { type: "string", enum: ["serious", "humorous", "controversial", "informative", "emotional", "casual"] },
    keyThemes: { type: "array", items: { type: "string" }, maxItems: 5 },
    conversationalHooks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hook: { type: "string" },
          placement: { type: "string", enum: ["intro", "transition", "conclusion"] },
          tone: { type: "string", enum: ["curious", "dramatic", "light", "serious", "teasing"] }
        }
      }
    },
    threadAnalysis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
          emotionalIntensity: { type: "number", minimum: 1, maximum: 10 },
          discussionType: { type: "string", enum: ["debate", "question", "story", "advice", "humor"] },
          suggestedVoiceStyle: {  type: "string", enum: ["narrative", "excited", "empathetic", "neutral", "calm", "conversational", "news", "cheerful", "friendly", "newscast", "serious"] },
          hostCommentary: { type: "string", description: "Ready to use as host commentary on the subject" },
          transitionPhrase: { type: "string" , description: "Ready to use transition phase to be used to transition to the next topic" }
        }
      }
    }
  }
};

async function analyzeContentWithPerplexity(threads, context) {
  const contentSummary = threads.map((thread, idx) =>
    `Thread ${idx + 1}: "${thread.title}" - ${thread.content.substring(0, 200)}... Top comments: ${thread.comments.slice(0, 3).join(' | ')}`
  ).join('\n\n');

  const body = {

    model: "sonar",
    messages: [
      {
        role: "system",
        content: `You are an expert podcast producer skilled in voice-driven storytelling. Your task is to analyze Reddit threads and produce structured analysis suitable for high-quality TTS audio production.

Return data in **strict JSON format** that adheres to the provided schema. Your output will be parsed by automated systems — do not include free text, only valid JSON.

Requirements:
- Assign an **overall tone** for the full batch.
- Identify **up to 5 key themes**.
- Suggest **conversational hooks** for host delivery, specifying their placement and tone.
- For each thread:
  - Determine **sentiment**, **emotional intensity** (1–10), and **discussion type**.
  - Recommend a **voice style**, including pitch/rate/style (if applicable).
  - Write a **host commentary** (1-2 sentences, SSML-friendly) summarizing or reacting to the thread.
  - Add a **transition phrase** to move to the next thread smoothly.

Avoid generalities. Be specific, precise, and compatible with TTS output.

Schema follows:
${contentAnalysisSchema}`
      },
      {
        role: "user",
        content: `Analyze these Reddit threads for podcast production:
${contentSummary}
                   
Provide analysis including overall tone, key themes, conversational hooks, 
and specific guidance for each thread including sentiment, emotional intensity, 
discussion type, suggested voice styles, host commentary, and smooth transitions.
`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: { schema: contentAnalysisSchema }
    },
    max_tokens: 2000
  };

  const request = () => fetch(PERPLEXITY_BASE_URL, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }).then(res => res.json());

  try {
    const response = await pRetry(request, { retries: 3 });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    context.error('Perplexity API failure:', err);
    return generateFallbackAnalysis(threads);
  }
}

function generateFallbackAnalysis(threads) {
  return {
    overallTone: "casual",
    keyThemes: ["discussion", "community", "sharing"],
    conversationalHooks: [{ hook: "Let's see what caught everyone's attention today", placement: "intro", tone: "friendly" }],
    threadAnalysis: threads.map((_, idx) => ({
      sentiment: "neutral",
      emotionalIntensity: 5,
      discussionType: "discussion",
      suggestedVoiceStyle: "narration-professional",
      hostCommentary: "This is an interesting discussion point.",
      transitionPhrase: "Moving on to our next topic"
    }))
  };
}

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


function createConversationalTransition(_, toThread, analysis) {
  const transitions = ["Now, here's something completely different", "Speaking of which, this next one really caught my eye", "On a related note", "This next discussion takes an interesting turn", "Now for something that sparked quite the debate"];
  return escapeXml(analysis.threadAnalysis[toThread]?.transitionPhrase || transitions[Math.floor(Math.random() * transitions.length)]);
}

module.exports.generateSSMLEpisode = async function generateSSMLEpisode(input, context) {
  const ssmlChunks = [];
  context.log(`Analyzing content with Perplexity for ${input.threads.length} threads.`);
  const contentAnalysis = await analyzeContentWithPerplexity(input.threads, context);

  const introHook = contentAnalysis.conversationalHooks?.find(h => h.placement === "intro");
  const introContent = introHook
    ? `<s>Welcome to today's episode of Reddit Top Threads.</s><s><break time="300ms"/></s>
       <s>${escapeXml(introHook.hook)}.</s><s><break time="500ms"/></s>
       <s>We've got ${input.threads.length} fascinating discussions to explore today, 
          covering themes like ${contentAnalysis.keyThemes.slice(0, 3).join(', ')}.</s>`
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

    if (idx > 0) parts.push(generateDynamicSSML(createConversationalTransition(idx - 1, idx, contentAnalysis), voiceConfig.host.name, "newscast-casual", "neutral", 4));

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

  const outroHook = contentAnalysis.conversationalHooks?.find(h => h.placement === "conclusion");
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
