const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { uploadAudioToBlobStorage, uploadTranscriptToBlobStorage } = require("../shared/storageUtil");
const { getSecretClient } = require("../shared/keyVault");

class SpeechClient {
  static instance;

  constructor() {
    this.initialized = false;
  }

  static getInstance() {
    if (!SpeechClient.instance) {
      SpeechClient.instance = new SpeechClient();
    }
    return SpeechClient.instance;
  }

  async init() {
    if (this.initialized) return;

    const secretClient = getSecretClient();
    const key = process.env.AZURE_SPEECH_KEY || (await secretClient.getSecret("AZURE-SPEECH-KEY")).value;
    const region = process.env.AZURE_SPEECH_REGION;

    this.speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    this.speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;
    this.speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary, "true");

    this.initialized = true;
  }

  async getSpeechConfig() {
    await this.init();
    return this.speechConfig;
  }
}

function mergeWavBuffers(buffers) {
  const HEADER_SIZE = 44;
  const firstHeader = buffers[0].slice(0, HEADER_SIZE);
  const audioDataBuffers = buffers.map(buf => buf.slice(HEADER_SIZE));
  const totalAudioDataLength = audioDataBuffers.reduce((sum, b) => sum + b.length, 0);

  const mergedBuffer = Buffer.alloc(HEADER_SIZE + totalAudioDataLength);
  firstHeader.copy(mergedBuffer, 0);

  mergedBuffer.writeUInt32LE(36 + totalAudioDataLength, 4);
  mergedBuffer.writeUInt32LE(totalAudioDataLength, 40);

  let offset = HEADER_SIZE;
  for (const audioBuf of audioDataBuffers) {
    audioBuf.copy(mergedBuffer, offset);
    offset += audioBuf.length;
  }

  return mergedBuffer;
}

module.exports.synthesizeSSMLChunks = async function synthesizeSsmlChunks(input, context = {}) {
  if (context.env === 'TEST' && context.skip?.synthesis) {
    const path = require('path');
    const fs = require('fs');
    const mergedAudio = fs.readFileSync(path.join(process.cwd(), `src/data/${input.subreddit}/audio.wav`), 'utf-8');
    if (mergedAudio) {
      return { mergedAudio, fullTranscript: require(path.join(process.cwd(), `src/data/${input.subreddit}/transcript.json`)) };
    }
  }

  const { ssmlChunks, episodeId } = input;
  if (!Array.isArray(ssmlChunks) || ssmlChunks.length === 0) {
    throw new Error("Input must include non-empty ssmlChunks array.");
  }

  const transcripts = Array.from({ length: ssmlChunks.length }, () => []);
  const speechConfig = await SpeechClient.getInstance().getSpeechConfig();

  const synthesizeChunk = async (ssml, index) => {
    return new Promise((resolve, reject) => {
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

      synthesizer.wordBoundary = function (_, e) {
        if (e.boundaryType === sdk.SpeechSynthesisBoundaryType.Sentence) {
          transcripts[index].push({
            audioOffset: e.audioOffset,
            duration: e.duration,
            text: e.text,
            textOffset: e.textOffset,
            wordLength: e.wordLength
          });
        }
      };

      synthesizer.speakSsmlAsync(
        ssml,
        result => {
          synthesizer.close();

          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            context.log?.(`Synthesized chunk ${index + 1}/${ssmlChunks.length}`);
            resolve({
              duration: result.audioDuration,
              index,
              buffer: Buffer.from(result.audioData)
            });
          } else {
            reject(new Error(`Synthesis failed: ${result.errorDetails}`));
          }
        },
        err => {
          synthesizer.close();
          reject(err);
        }
      );
    });
  };

  const results = await Promise.all(ssmlChunks.map((ssml, i) => synthesizeChunk(ssml, i)));

  const sortedBuffers = results
    .sort((a, b) => a.index - b.index)
    .map(r => r.buffer);

  let cumulativeOffset = 0;
  for (const result of results) {
    for (const t of transcripts[result.index]) {
      t.audioOffset += cumulativeOffset;
    }
    cumulativeOffset += result.duration;
  }

  context.log?.(`Synthesis complete. Merging audio...`);
  const mergedAudio = mergeWavBuffers(sortedBuffers);
  const fullTranscript = transcripts.flat();

  if (context.env === 'TEST') {
    return { mergedAudio, fullTranscript };
  }

  const audioUrl = await uploadAudioToBlobStorage(mergedAudio, `audio/episode-${episodeId}.wav`);
  const transcriptsUrl = await uploadTranscriptToBlobStorage(fullTranscript, `transcripts/episode-${episodeId}.json`);

  return { audioUrl, transcriptsUrl };
};
