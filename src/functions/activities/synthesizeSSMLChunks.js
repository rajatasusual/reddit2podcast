const sdk = require("microsoft-cognitiveservices-speech-sdk");

const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm; // WAV PCM

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

module.exports.synthesizeSSMLChunks = async function synthesizeSsmlChunks(ssmlChunks, context) {
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

  const synthesizeChunk = async (ssml, index) => {
    return new Promise((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        result => {
          context.log(`🔊 Synthesized chunk ${index + 1}/${ssmlChunks.length}...`);
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

  context.log(`🔊 Synthesis complete. Merging chunks...`);

  return mergeWavBuffers(buffers);
}