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

  // 1. Upsert a canonical entity vertex (no document-specific info)
  async upsertCanonicalEntity(entity) {
    const vertexId = this.generateEntityId(entity);
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
          property('partitionKey', '${partitionKey}')
      )`;
    await this.gremlinClient.executeQuery(query);
    return vertexId;
  }

  // 2. Upsert a document vertex
  async upsertDocumentVertex(documentId, metadata) {
    const query = `g.V('${documentId}').
      fold().
      coalesce(
        unfold(),
        addV('document').
          property(id, '${documentId}').
          property('processedAt', '${new Date().toISOString()}').
          property('category', 'document').
          ${Object.keys(metadata).map(key => `property('${key}', '${this.escapeString(metadata[key])}').`).join('\n          ')}
          property('partitionKey', 'document')
      )`;
    await this.gremlinClient.executeQuery(query);
  }

  // 3. Create the 'appears_in' edge with contextual data
  async createAppearanceEdge(entity, canonicalEntityId, documentId) {
    // This query now ensures the 'appears_in' edge is not duplicated.
    const edgeQuery = `
      g.V('${canonicalEntityId}')
       .coalesce(
         __.outE('appears_in').where(inV().hasId('${documentId}')),
         __.addE('appears_in').to(g.V('${documentId}'))
           .property('confidenceScore', ${entity.confidenceScore})
           .property('createdAt', '${new Date().toISOString()}')
       )`;
    await this.gremlinClient.executeQuery(edgeQuery);
  }

  // 4. Relationships are now between canonical entities
  async createSemanticRelationship(entity1, entity2, documentId) {
    const entity1Id = this.generateEntityId(entity1);
    const entity2Id = this.generateEntityId(entity2);
    const relationshipType = this.determineRelationshipType(entity1, entity2);

    if (relationshipType === 'co_occurs') return; // Skip generic relationships if desired

    // This is the most robust pattern for upserting an edge.
    // It maintains context using .as() and ensures the creation step only runs if the edge doesn't exist.
    const edgeQuery = `
      g.V('${entity1Id}').as('a')
       .coalesce(
         __.outE('${relationshipType}').where(inV().hasId('${entity2Id}')),
         __.addE('${relationshipType}').from('a').to(g.V('${entity2Id}'))
           .property('firstSeenIn', '${documentId}')
           .property('firstSeenAt', '${new Date().toISOString()}')
       )`;
    await this.gremlinClient.executeQuery(edgeQuery);
  }

  generateEntityId(entity) {
    const textHash = Buffer.from(entity.text.toLowerCase()).toString('base64');
    return `${textHash}`;
  }

  escapeString(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
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