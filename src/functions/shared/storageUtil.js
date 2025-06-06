const { BlobServiceClient } = require('@azure/storage-blob');
const { getSecretClient } = require('./keyVault');

class BlobContainerManager {
  static instance;

  constructor() {
    this.initialized = false;
  }

  static getInstance() {
    if (!BlobContainerManager.instance) {
      BlobContainerManager.instance = new BlobContainerManager();
    }
    return BlobContainerManager.instance;
  }

  async init() {
    if (this.initialized) return;

    const secretClient = getSecretClient();
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING ||
      (await secretClient.getSecret("AZURE-STORAGE-CONNECTION-STRING")).value;

    this.blobServiceClient = BlobServiceClient.fromConnectionString(connStr);

    const account = process.env.AZURE_STORAGE_ACCOUNT;
    this.publicContainerClient = this.blobServiceClient.getContainerClient(`${account}-public`);
    this.privateContainerClient = this.blobServiceClient.getContainerClient(`${account}-audio`);

    this.initialized = true;
  }

  async uploadToPublic(buffer, filename, contentType = "application/octet-stream") {
    await this.init();
    await this.publicContainerClient.createIfNotExists({ access: "blob" });

    const blockBlobClient = this.publicContainerClient.getBlockBlobClient(filename);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    return blockBlobClient.url;
  }

  async uploadToPrivate(buffer, filename, contentType = "application/octet-stream") {
    await this.init();
    await this.privateContainerClient.createIfNotExists();

    const blockBlobClient = this.privateContainerClient.getBlockBlobClient(filename);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    return blockBlobClient.url;
  }
}

// --- Convenience wrappers ---

async function uploadBufferToPublicBlob(buffer, filename, contentType) {
  const manager = BlobContainerManager.getInstance();
  return await manager.uploadToPublic(buffer, filename, contentType);
}

async function uploadBufferToPrivateBlob(buffer, filename, contentType) {
  const manager = BlobContainerManager.getInstance();
  return await manager.uploadToPrivate(buffer, filename, contentType);
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
  uploadTranscriptToBlobStorage,
};
