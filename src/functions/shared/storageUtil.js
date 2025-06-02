const { BlobServiceClient } = require('@azure/storage-blob');
// --- Blob Storage setup ---
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const publicContainerClient = blobServiceClient.getContainerClient(`${process.env.AZURE_STORAGE_ACCOUNT}-public`);
const privateContainerClient = blobServiceClient.getContainerClient(`${process.env.AZURE_STORAGE_ACCOUNT}-audio`);

async function uploadBufferToPublicBlob(buffer, filename, contentType = "application/octet-stream") {
  await publicContainerClient.createIfNotExists(
    { access: "blob" }
  );
  const blockBlobClient = publicContainerClient.getBlockBlobClient(filename);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType }
  });
  return blockBlobClient.url;
}

async function uploadBufferToPrivateBlob(buffer, filename, contentType = "application/octet-stream") {
  await privateContainerClient.createIfNotExists();
  const blockBlobClient = privateContainerClient.getBlockBlobClient(filename);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType }
  });
  return blockBlobClient.url;
}

async function uploadXmlToBlobStorage(xmlString, filename) {
  const buffer = Buffer.from(xmlString, 'utf-8');
  return await uploadBufferToPrivateBlob(buffer, filename, 'application/xml');
}

async function uploadJsonToBlobStorage(threads, filename) {
  const jsonString = JSON.stringify(threads, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');
  return await uploadBufferToPrivateBlob(buffer, filename, 'application/json');
}


async function uploadAudioToBlobStorage(buffer, filename) {
  return await uploadBufferToPrivateBlob(buffer, filename, 'audio/x-wav');
}

async function uploadTranscriptToBlobStorage(transcript, filename) {
  const jsonString = JSON.stringify(transcript, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');
  return await uploadBufferToPrivateBlob(buffer, filename, 'application/json');
}

module.exports = {
  uploadBufferToPublicBlob,
  uploadXmlToBlobStorage,
  uploadJsonToBlobStorage,
  uploadAudioToBlobStorage,
  uploadTranscriptToBlobStorage
};