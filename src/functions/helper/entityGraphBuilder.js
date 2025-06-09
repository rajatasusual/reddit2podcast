// entityGraphBuilder.js

class EntityGraphBuilder {
  static instance = null;

  static getInstance() {
    if (!EntityGraphBuilder.instance) {
      EntityGraphBuilder.instance = new EntityGraphBuilder();
    }
    return EntityGraphBuilder.instance;
  }

  constructor() {
    if (EntityGraphBuilder.instance) {
      return EntityGraphBuilder.instance;
    }
    this.gremlinClient = require('../shared/gremlinClient');
    EntityGraphBuilder.instance = this;
  }

  getGremlinClient() {
    return this.gremlinClient;
  }

  async upsertEntityVertex(entity, documentId, sourceText = '') {
    const vertexId = this.generateEntityId(entity, documentId);
    const partitionKey = entity.category.toLowerCase();

    const query = `g.V('${vertexId}').
      fold().
      coalesce(
        unfold(),
        addV('entity').
            property(id, '${vertexId}').
            property('text', '${this.escapeString(entity.text)}').
            property('category', '${entity.category}').
            property('subCategory', '${entity.subCategory || ''}').
            property('confidenceScore', ${entity.confidenceScore}).
            property('documentId', '${documentId}').
            property('offset', ${entity.offset}).
            property('length', ${entity.length}).
            property('sourceText', '${this.escapeString(sourceText)}').
            property('createdAt', '${new Date().toISOString()}').
            property('partitionKey', '${partitionKey}')
      )`;

    return await this.gremlinClient.executeQuery(query);
  }

  generateEntityId(entity, documentId) {
    // Create unique ID combining document, entity text, and position
    const textHash = Buffer.from(entity.text.toLowerCase()).toString('base64');
    return `${documentId}_${textHash}_${entity.offset}`;
  }

  escapeString(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  async createDocumentRelationships(entities, documentId) {
    const relationships = [];

    // Create co-occurrence relationships between entities in the same document
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const entity1Id = this.generateEntityId(entities[i], documentId);
        const entity2Id = this.generateEntityId(entities[j], documentId);

        const proximity = Math.abs(entities[i].offset - entities[j].offset);
        const relationshipType = this.determineRelationshipType(entities[i], entities[j]);

        const edgeQuery = `g.V('${entity1Id}')
        .addE('${relationshipType}')
        .to(g.V('${entity2Id}'))
        .property('documentId', '${documentId}')
        .property('proximity', ${proximity})
        .property('confidenceProduct', ${entities[i].confidenceScore * entities[j].confidenceScore})
        .property('createdAt', '${new Date().toISOString()}')`;

        relationships.push(edgeQuery);
      }
    }

    return relationships;
  }

  async createRelationshipsBetweenEntities(entities, documentId) {
     const highConfidenceEntities = entities.filter(e => e.confidenceScore >= 0.7);
    if (highConfidenceEntities.length > 1) {
      const relationships = await this.createDocumentRelationships(highConfidenceEntities, documentId);

      for (const relationshipQuery of relationships) {
        await this.gremlinClient.executeQuery(relationshipQuery);
      }

      return { highConfidenceEntities, relationships };
    }

  }

  determineRelationshipType(entity1, entity2) {
    if (entity1.category === entity2.category) {
      return 'same_category';
    }

    // Define semantic relationships based on category combinations
    const categoryPairs = {
      'Person-Organization': 'works_for',
      'Person-Location': 'located_in',
      'Organization-Location': 'based_in',
      'Event-Location': 'occurs_in',
      'Event-Person': 'involves'
    };

    const pairKey = `${entity1.category}-${entity2.category}`;
    const reversePairKey = `${entity2.category}-${entity1.category}`;

    return categoryPairs[pairKey] || categoryPairs[reversePairKey] || 'co_occurs';
  }
}

module.exports = EntityGraphBuilder.getInstance();
