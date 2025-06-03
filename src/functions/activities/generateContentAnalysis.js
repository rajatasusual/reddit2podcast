const { default: pRetry } = require('p-retry');

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai/chat/completions';

const contentAnalysisSchema = {
  type: "object",
  properties: {
    keyThemes: { type: "array", items: { type: "string" }, maxItems: 5 },
    conversationalHooks: {
      type: "object",
      properties: {
        intro: { type: "string", description: "Ready to use as 2-3 sentence intro to the episode." },
        conclusion: { type: "string", description: "Ready to use as 2-3 sentence conclusion to the episode" },
      }
    },
    threadAnalysis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
          emotionalIntensity: { type: "number", minimum: 1, maximum: 10 },
          suggestedVoiceStyle: { type: "string", enum: ["narrative", "excited", "empathetic", "neutral", "calm", "conversational", "news", "cheerful", "friendly", "newscast", "serious"] },
          hostCommentary: { type: "string", description: "Ready to use as host commentary on the subject" },
          transitionPhrase: { type: "string", description: "Ready to use transition phase to be used to transition to this thread" }
        }
      }
    }
  }
};

function generateFallbackAnalysis(threads) {
  return {
    keyThemes: ["discussion", "community", "sharing"],
    conversationalHooks: {
      intro: "Join us as we dive into today's intriguing discussions and uncover unexpected insights.",
      conclusion: "Thanks for tuning in. Stay curious and join us next time for more enlightening conversations."
    },
    threadAnalysis: threads.map((_, idx) => ({
      sentiment: "neutral",
      emotionalIntensity: 5,
      suggestedVoiceStyle: "narration-professional",
      hostCommentary: "This is an interesting discussion point.",
      transitionPhrase: "Moving on to our next topic"
    }))
  };
}

module.exports.generateContentAnalysis = async function analyzeContentWithPerplexity(input, context) {
  if (context.env === 'TEST' && context.skip?.ssml) {
    const path = require('path');
    const contentAnalysis = require(path.join(process.cwd(), 'src/data/contentAnalysis.json'));
    if (contentAnalysis) {
      return contentAnalysis;
    }
  }

  const threads = input.threads;
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
- Identify **up to 5 key themes**.
- Suggest **conversational hooks** for host delivery during intro and conclusion.
- For each thread:
  - Determine **sentiment**, **emotional intensity** (1–10).
  - Recommend a **voice style**, including pitch/rate/style (if applicable).
  - Write a **host commentary** (1-2 sentences, SSML-friendly) summarizing or reacting to the thread.
  - Add a **transition phrase** to move to this thread smoothly.

Avoid generalities. Be specific, precise, and compatible with TTS output.
`
      },
      {
        role: "user",
        content: `Analyze these Reddit threads for podcast production:
${contentSummary}
                   
Provide analysis including key themes, conversational hooks, 
and specific guidance for each thread including sentiment, emotional intensity, 
suggested voice styles, host commentary, and smooth transitions.
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