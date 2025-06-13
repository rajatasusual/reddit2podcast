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
      "Person-Organization": "works_for",
      "Person-Location": "resides_in",
      "Organization-Location": "based_in",
      "Event-Location": "occurs_in",
      "Event-Person": "attended_by",

      "Person-Person": "colleague_of",
      "Person-PersonType": "has_title",
      "Person-Event": "organized_event",
      "Person-Product": "uses_product",
      "Person-Skill": "has_skill",
      "Person-Address": "lives_at",
      "Person-PhoneNumber": "has_phone_number",
      "Person-Email": "has_email",
      "Person-URL": "has_website",
      "Person-IP": "last_seen_at_ip",
      "Person-DateTime": "born_on",
      "Person-Quantity": "has_age",

      "Organization-Person": "employs",
      "Organization-Organization": "partner_of",
      "Organization-Product": "produces",
      "Organization-Event": "sponsors",
      "Organization-Address": "headquartered_at",
      "Organization-PhoneNumber": "has_contact_number",
      "Organization-Email": "has_contact_email",
      "Organization-URL": "official_website",
      "Organization-DateTime": "founded_on",
      "Organization-Quantity": "has_employee_count",
      "Organization-IP": "owns_ip_range",
      "Organization-Skill": "requires_skill",

      "Event-Organization": "hosted_by",
      "Event-Product": "featured_product",
      "Event-DateTime": "scheduled_for",
      "Event-Address": "held_at_address",
      "Event-URL": "has_event_page",
      "Event-Quantity": "expected_attendees",

      "Product-Organization": "manufactured_by",
      "Product-Location": "sold_in",
      "Product-DateTime": "released_on",
      "Product-Quantity": "has_price",
      "Product-URL": "has_product_page",
      "Product-Skill": "requires_skill_to_operate",

      "Skill-PersonType": "skill_for_role",
      "Address-Location": "is_in_city_or_country",
      "PersonType-Organization": "role_within_organization"
    };

    const pairKey = `${entity1.category}-${entity2.category}`;
    const reversePairKey = `${entity2.category}-${entity1.category}`;

    return categoryPairs[pairKey] || categoryPairs[reversePairKey] || 'co_occurs';
  }
}

module.exports = EntityGraphBuilder.getInstance();
