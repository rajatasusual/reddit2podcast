const { uploadXmlToBlobStorage } = require('../shared/storageUtil');
const { extractiveSummarization, abstractiveSummarization } = require('../summarizer');
const axios = require('axios');

// Perplexity API integration
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai/chat/completions';

// Enhanced voice configuration with personality traits
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

// Structured output schema for Perplexity API
const contentAnalysisSchema = {
  type: "object",
  properties: {
    overallTone: {
      type: "string",
      enum: ["serious", "humorous", "controversial", "informative", "emotional", "casual"]
    },
    keyThemes: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    },
    conversationalHooks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hook: { type: "string" },
          placement: { type: "string", enum: ["intro", "transition", "conclusion"] },
          tone: { type: "string" }
        }
      }
    },
    threadAnalysis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          threadIndex: { type: "number" },
          sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
          emotionalIntensity: { type: "number", minimum: 1, maximum: 10 },
          discussionType: { type: "string", enum: ["debate", "question", "story", "advice", "humor"] },
          suggestedVoiceStyle: { type: "string" },
          hostCommentary: { type: "string" },
          transitionPhrase: { type: "string" }
        }
      }
    }
  }
};

async function analyzeContentWithPerplexity(threads, context) {
  try {
    const contentSummary = threads.map((thread, idx) => 
      `Thread ${idx + 1}: "${thread.title}" - ${thread.content.substring(0, 200)}... 
       Top comments: ${thread.comments.slice(0, 3).join(' | ')}`
    ).join('\n\n');

    const response = await axios.post(PERPLEXITY_BASE_URL, {
      model: "sonar",
      messages: [
        {
          role: "system",
          content: `You are an expert podcast producer analyzing Reddit content to create engaging audio experiences. 
                   Analyze the provided threads for tone, themes, and conversational opportunities. 
                   Provide structured insights for dynamic voice modulation and conversational flow.`
        },
        {
          role: "user",
          content: `Analyze these Reddit threads for podcast production:
                   ${contentSummary}
                   
                   Provide analysis including overall tone, key themes, conversational hooks, 
                   and specific guidance for each thread including sentiment, emotional intensity, 
                   discussion type, suggested voice styles, host commentary, and smooth transitions.`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { schema: contentAnalysisSchema }
      },
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return JSON.parse(response.data.choices[0].message.content);
  } catch (error) {
    context.log.error('Perplexity API error:', error);
    // Fallback to basic analysis
    return generateFallbackAnalysis(threads);
  }
}

function generateFallbackAnalysis(threads) {
  return {
    overallTone: "casual",
    keyThemes: ["discussion", "community", "sharing"],
    conversationalHooks: [
      { hook: "Let's see what caught everyone's attention today", placement: "intro", tone: "friendly" }
    ],
    threadAnalysis: threads.map((_, idx) => ({
      threadIndex: idx,
      sentiment: "neutral",
      emotionalIntensity: 5,
      discussionType: "discussion",
      suggestedVoiceStyle: "narration-professional",
      hostCommentary: "This is an interesting discussion point.",
      transitionPhrase: "Moving on to our next topic"
    }))
  };
}

function generateDynamicSSML(content, voiceName, style, sentiment, intensity, additionalAttributes = {}) {
  const intensityMapping = {
    1: { rate: "x-slow", volume: "soft" },
    2: { rate: "slow", volume: "soft" },
    3: { rate: "slow", volume: "medium" },
    4: { rate: "medium", volume: "medium" },
    5: { rate: "medium", volume: "medium" },
    6: { rate: "medium", volume: "loud" },
    7: { rate: "fast", volume: "loud" },
    8: { rate: "fast", volume: "x-loud" },
    9: { rate: "x-fast", volume: "x-loud" },
    10: { rate: "x-fast", volume: "x-loud" }
  };

  const prosodySettings = intensityMapping[Math.min(10, Math.max(1, intensity))];
  
  const pitchAdjustment = sentiment === "positive" ? "+10%" : 
                         sentiment === "negative" ? "-10%" : "medium";

  return `
    <voice name="${voiceName}">
      <mstts:express-as style="${style}" ${additionalAttributes.degree ? `styledegree="${additionalAttributes.degree}"` : ''}>
        <prosody rate="${prosodySettings.rate}" volume="${prosodySettings.volume}" pitch="${pitchAdjustment}">
          ${content}
        </prosody>
      </mstts:express-as>
    </voice>`;
}

function createConversationalTransition(fromThread, toThread, analysis) {
  const transitions = [
    "Now, here's something completely different",
    "Speaking of which, this next one really caught my eye",
    "On a related note",
    "This next discussion takes an interesting turn",
    "Now for something that sparked quite the debate"
  ];
  
  const transition = analysis.threadAnalysis[toThread]?.transitionPhrase || 
                    transitions[Math.floor(Math.random() * transitions.length)];
  
  return `<s><break time="500ms"/></s><s>${escapeXml(transition)}.</s><s><break time="300ms"/></s>`;
}

function wrapSsmlBlock(content) {
  return `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
      xmlns:mstts="http://www.w3.org/2001/mstts"
      xml:lang="en-US">${content}</speak>`;
}

function combineSsmlChunks(ssmlChunks) {
  const stripSpeakTags = (ssml) => {
    return ssml
      .replace(/^<speak[^>]*>/, '')
      .replace(/<\/speak>$/, '');
  };

  const combinedContent = ssmlChunks.map(stripSpeakTags).join('\n');

  const finalSsml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" 
       xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
${combinedContent}
</speak>`;

  return finalSsml;
}

function escapeXml(text) {
  if (!text) return '';
  return text.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&apos;',
    '"': '&quot;'
  })[c]);
}

module.exports.generateSSMLEpisode = async function generateSSMLEpisode(input, context) {
  const ssmlChunks = [];
  
  context.log(`Analyzing content with Perplexity for ${input.threads.length} threads.`);
  
  // Get AI-powered content analysis
  const contentAnalysis  = await analyzeContentWithPerplexity(input.threads, context);
  
  context.log(`Content analysis complete. Overall tone: ${contentAnalysis.overallTone}`);

  // Dynamic intro based on content analysis
  const introHook = contentAnalysis.conversationalHooks.find(h => h.placement === "intro");
  const introContent = introHook 
    ? `<s>Welcome to today's episode of Reddit Top Threads.</s><s><break time="300ms"/></s>
       <s>${escapeXml(introHook.hook)}.</s><s><break time="500ms"/></s>
       <s>We've got ${input.threads.length} fascinating discussions to explore today, 
          covering themes like ${contentAnalysis.keyThemes.slice(0, 3).join(', ')}.</s>`
    : `<s>Welcome to today's episode of Reddit Top Threads.</s>
       <s>Let's dive into today's most engaging discussions!</s>`;

  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(
    introContent,
    voiceConfig.host.name,
    "cheerful",
    "positive",
    6,
    { degree: "2" }
  )));

  // Enhanced summary with conversational elements
  const documents = input.threads.map(thread => `${thread.title} ${thread.comments.join(' ')}`);
  const summary = await extractiveSummarization(documents, context);
  
  const summaryContent = `<s>Here's what we're covering today:</s>
    ${(summary.match(/[^\.!\?]+[\.!\?]+/g) || []).map((sentence, idx) => {
      return `<s><break time="200ms"/></s><s>${escapeXml(sentence)}</s><s><break time="500ms"/></s>`;
    }).join('')}
    <s>Let's get started!</s>`;

  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(
    summaryContent,
    voiceConfig.host.name,
    "narration-professional",
    "neutral",
    5
  )));

  // Process threads with enhanced conversational flow
  for (let idx = 0; idx < input.threads.length; idx++) {
    const thread = input.threads[idx];
    const threadAnalysis = contentAnalysis.threadAnalysis[idx] || {};
    const threadSsmlParts = [];

    // Add transition if not first thread
    if (idx > 0) {
      threadSsmlParts.push(generateDynamicSSML(
        createConversationalTransition(idx - 1, idx, contentAnalysis),
        voiceConfig.host.name,
        "newscast-casual",
        "neutral",
        4
      ));
    }

    // Thread title with dynamic emphasis based on emotional intensity
    const titleEmphasis = threadAnalysis.emotionalIntensity > 7 ? "strong" : "moderate";
    threadSsmlParts.push(generateDynamicSSML(
      `<s><emphasis level="${titleEmphasis}">Thread ${idx + 1}:</emphasis> ${escapeXml(thread.title)}</s>`,
      voiceConfig.host.name,
      threadAnalysis.suggestedVoiceStyle || "newscast-casual",
      threadAnalysis.sentiment || "neutral",
      threadAnalysis.emotionalIntensity || 5
    ));

    // Enhanced thread content with host commentary
    const threadContent = `${thread.title} ${thread.content} ${thread.comments.join('.')}`;
    const threadSummary = await abstractiveSummarization([threadContent], context);
    
    const contentWithCommentary = `<s>${escapeXml(threadSummary)}</s>
      <s><break time="300ms"/></s><s>${escapeXml(threadAnalysis.hostCommentary || 'This generated quite a discussion.')}</s>
      `;

    threadSsmlParts.push(generateDynamicSSML(
      contentWithCommentary,
      voiceConfig.host.name,
      "narration-professional",
      threadAnalysis.sentiment || "neutral",
      Math.min(6, (threadAnalysis.emotionalIntensity || 5) + 1)
    ));

    // Dynamic comment presentation with varied voices
    if (thread.comments && thread.comments.length > 0) {
      threadSsmlParts.push(generateDynamicSSML(
        `<s>Let's hear what the community had to say:</s><s><break time="300ms"/></s>`,
        voiceConfig.host.name,
        "friendly",
        "positive",
        5
      ));

      thread.comments.slice(0, Math.min(4, thread.comments.length)).forEach((comment, i) => {
        const commenterVoice = voiceConfig.commenters[i % voiceConfig.commenters.length];
        const commentSentiment = threadAnalysis.sentiment || "neutral";
        
        threadSsmlParts.push(generateDynamicSSML(
          `<s>${escapeXml(comment)}</s>`,
          commenterVoice.name,
          commenterVoice.style,
          commentSentiment,
          Math.max(3, (threadAnalysis.emotionalIntensity || 5) - 1)
        ));
      });
    }

    ssmlChunks.push(wrapSsmlBlock(threadSsmlParts.join('\n')));
  }

  // Dynamic outro based on content analysis
  const outroHook = contentAnalysis.conversationalHooks.find(h => h.placement === "conclusion");
  const outroContent = outroHook 
    ? `<s>${escapeXml(outroHook.hook)}</s>
       
       <s><break time="300ms"/></s><s>That wraps up today's episode covering ${contentAnalysis.keyThemes.join(', ')}.</s>
       <s>Thanks for joining our community discussion!</s>`
    : `<s>What a fascinating dive into today's top discussions!</s>
       <s>Thanks for listening, and we'll see you next time!</s>`;

  ssmlChunks.push(wrapSsmlBlock(generateDynamicSSML(
    outroContent,
    voiceConfig.host.name,
    "cheerful",
    "positive",
    6,
    { degree: "2" }
  )));

  if (context.env === 'TEST') {
    return { 
      ssmlChunks, 
      summary, 
      contentAnalysis,
      ssmlUrl: '' 
    };
  }

  const finalSsml = combineSsmlChunks(ssmlChunks);
  const ssmlUrl = await uploadXmlToBlobStorage(finalSsml, `xml/episode-${input.episodeId}.ssml.xml`);

  return { 
    ssmlChunks, 
    summary, 
    contentAnalysis,
    ssmlUrl 
  };
};
