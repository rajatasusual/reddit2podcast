const { app } = require('@azure/functions');
require("dotenv").config();

class EntitiesManager {
    static instance;

    constructor() {
        this.initialized = false;
    }

    static getInstance() {
        if (!EntitiesManager.instance) {
            EntitiesManager.instance = new EntitiesManager();
        }
        return EntitiesManager.instance;
    }

    async init() {
        if (this.initialized) return;

        this.languageClient = await require('./language').LanguageClientManager.getClient();
        this.graphBuilder = require('./helper/entityGraphBuilder');

        this.initialized = true;
    }

    async getLanguageClient() {
        await this.init();
        return this.languageClient;
    }

    async getGraphBuilder() {
        await this.init();
        return this.graphBuilder;
    }
}

async function updateEntitiesInGraph(entities, documentId, context) {
    try {
        const graphBuilder = await (EntitiesManager.getInstance()).getGraphBuilder();
        // Create entity vertices
        for (const entity of entities) {
            if (entity.confidenceScore >= 0.7) { // Only store high-confidence entities
                await graphBuilder.upsertEntityVertex(entity, documentId);
            }
        }

        context.log(`Created ${entities.length} entity vertices`);

        // Create relationships between entities
        const { highConfidenceEntities, relationships } = await graphBuilder.createRelationshipsBetweenEntities(entities, documentId);

        context.log(`Created ${relationships.length} relationships between ${highConfidenceEntities.length} high-confidence entities`);

        return { highConfidenceEntities, relationships };

    } catch (error) {
        context.log(`Error processing entities for document ${documentId}:`, error);
        throw error;
    }
}

async function performEntityExtraction(documents, context) {
    context.log(`Performing entity extraction with graph database integration`);

    try {
        const languageClient = await (EntitiesManager.getInstance()).getLanguageClient();
        const results = await languageClient.analyze("EntityRecognition", documents, "en");
        let extracted = [];

        for (const result of results) {
            if (result.error) {
                const { code, message } = result.error;
                throw new Error(`Error (${code}): ${message}`);
            }

            const entities = result.entities.map(entity => ({
                text: entity.text,
                category: entity.category,
                subCategory: entity.subCategory,
                confidenceScore: entity.confidenceScore,
                offset: entity.offset,
                length: entity.length,
            }));

            // Store entities in graph database
            const { highConfidenceEntities, relationships } = await updateEntitiesInGraph(entities, result.id, context);

            extracted.push({ id: result.id, entities: highConfidenceEntities, relationships });
        }

        return extracted;

    } catch (err) {
        context.log("Entity extraction or graph processing error:", err);
        throw err;
    }
}

app.http('entityExtraction', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'extract',
    handler: async (request, context) => {
        try {
            const body = await request.json() || {};
            if (!Array.isArray(body.documents)) {
                return { status: 400, body: "Missing or invalid 'documents' array." };
            }
            const result = await performEntityExtraction(body.documents, context);
            return { status: 200, body: result };
        } catch (err) {
            return { status: 500, body: err.message };
        }
    }
});

module.exports = {
    entityExtraction: async (docs, ctx) => await performEntityExtraction(docs, ctx),
}