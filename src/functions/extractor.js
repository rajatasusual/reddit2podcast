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
    const graphBuilder = await EntitiesManager.getInstance().getGraphBuilder();

    // 1. Create a vertex for the document itself
    await graphBuilder.upsertDocumentVertex(documentId);
    context.log(`Upserted document vertex for: ${documentId}`);

    const highConfidenceEntities = entities.filter(e => e.confidenceScore >= 0.7);

    // 2. Process each high-confidence entity
    for (const entity of highConfidenceEntities) {
        // Create the canonical vertex for the entity (e.g., "Microsoft")
        const canonicalEntityId = await graphBuilder.upsertCanonicalEntity(entity);

        // Link this specific occurrence to the document
        await graphBuilder.createAppearanceEdge(entity, canonicalEntityId, documentId);
    }
    context.log(`Processed ${highConfidenceEntities.length} entity appearances for document ${documentId}`);

    // 3. Create semantic relationships between the canonical entities
    if (highConfidenceEntities.length > 1) {
        for (let i = 0; i < highConfidenceEntities.length; i++) {
            for (let j = i + 1; j < highConfidenceEntities.length; j++) {
                await graphBuilder.createSemanticRelationship(highConfidenceEntities[i], highConfidenceEntities[j], documentId);
            }
        }
        context.log(`Updated semantic relationships based on document ${documentId}`);
    }

    return {
        highConfidenceEntities
    };
}

async function performEntityExtraction(document, context) {
    context.log(`Performing entity extraction with graph database integration`);

    let extracted = [];

    try {
        const languageClient = await (EntitiesManager.getInstance()).getLanguageClient();
        const results = await languageClient.analyze("EntityRecognition", document.content, "en");

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

            const id = document.id || result.id;
            // Store entities in graph database
            const { highConfidenceEntities } = await updateEntitiesInGraph(entities, id, context);

            extracted.push({ id, entities: highConfidenceEntities });
        }

    } catch (err) {
        context.log("Entity extraction or graph processing error:", err);
        throw err;
    } finally {
        context.log("Entity extraction completed");
        return extracted;
    }
}

app.http('entityExtraction', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'extract',
    handler: async (request, context) => {
        try {
            const body = await request.json() || {};
            if (body.document && !Array.isArray(body.document.content)) {
                return { status: 400, body: "Missing or invalid 'documents' array." };
            }
            const result = await performEntityExtraction(body.document, context);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            };
        } catch (err) {
            context.log("Function Error:", { message: err.message, stack: err.stack });
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'An internal server error occurred.'
                })
            };
        }
    }
});

module.exports = {
    entityExtraction: async (docs, ctx) => await performEntityExtraction(docs, ctx),
}