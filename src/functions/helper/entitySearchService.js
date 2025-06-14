// entitySearchService.js
const cosmosClient = require('../shared/gremlinClient');

class EntitySearchService {
  // ... (Singleton getInstance and constructor are correct)
  static getInstance() {
    if (!EntitySearchService.instance) {
      EntitySearchService.instance = new EntitySearchService();
    }
    return EntitySearchService.instance;
  }

  constructor() {
    if (EntitySearchService.instance) {
      return EntitySearchService.instance;
    }
    EntitySearchService.instance = this;
  }

  /**
   * Finds canonical entity vertices by their category.
   * Purpose: General search for entities of a certain type (e.g., all 'Organizations').
   */
  async findEntitiesByCategory(category, limit = 100) {
    const query = `g.V().hasLabel('entity').has('category', c).limit(l).valueMap(true)`;
    const bindings = { c: category, l: limit };
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * Finds all entities that appear in a specific document, including their context.
   * Purpose: Reconstruct the entities found in a single piece of text.
   */
  async findEntitiesInDocument(documentId) {
    const query = `g.V(docId).hasLabel('document')
      .inE('appears_in')
      .project('context', 'entity')
        .by(valueMap(true))
        .by(outV().valueMap(true))`;
    const bindings = { docId: documentId };
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * Finds entities semantically related to a given entity by traversing the knowledge graph.
   * Purpose: Discover connections (e.g., find people who work for 'Microsoft').
   */
  async findRelatedEntities(entityText, maxHops = 2, limit = 50) {
    const query = `g.V().has('entity', 'text', entityTxt)
      .repeat(both().simplePath()).times(${maxHops})
      .hasLabel('entity').dedup().limit(l).valueMap(true)`;
    const bindings = { entityTxt: entityText, l: limit };
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * Finds canonical entity vertices using a partial text search.
   * Purpose: Power a search bar or autocomplete feature.
   */
  async searchEntitiesByTextPattern(pattern, category = null) {
    let query = `g.V().hasLabel('entity')`;
    const bindings = { p: pattern };

    if (category) {
      query += `.has('category', c)`;
      bindings.c = category;
    }
    query += `.has('text', containing(p)).limit(100).valueMap(true)`;
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * Finds entities that are semantically connected to ALL of the given source entities.
   * Purpose: Advanced analysis (e.g., find locations that are bases for 'Microsoft' AND 'Amazon').
   */
  async findCommonConnections(entityTexts = [], limit = 10) {
    if (entityTexts.length < 2) {
      throw new Error("At least two entity texts are required to find common connections.");
    }
    const query = `g.V().has('entity', 'text', within(sourceEntities)).as('source')
        .both().where(without('source'))
        .groupCount()
        .unfold()
        .where(select(values).is(eq(numSources)))
        .select(keys)
        .limit(l)
        .valueMap(true)`;
    const bindings = { 
        sourceEntities: entityTexts, 
        numSources: entityTexts.length,
        l: limit 
    };
    return await cosmosClient.executeQuery(query, bindings);
  }
  
  // ====================================================================
  // NEW AND ENHANCED FUNCTIONS FOR THE CANONICAL GRAPH
  // ====================================================================

  /**
   * NEW: Finds all documents where a specific entity appears.
   * Purpose: The inverse of findEntitiesInDocument (e.g., find all articles mentioning 'Azure').
   */
  async findDocumentsForEntity(entityText, limit = 50) {
    const query = `g.V().has('entity', 'text', entityTxt)
      .out('appears_in')
      .limit(l)
      .valueMap(true)`;
    const bindings = { entityTxt: entityText, l: limit };
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * NEW & REFINED: Finds pairs of entities that frequently appear in the same documents.
   * This is the correct implementation of co-occurrence for the canonical model.
   * Purpose: Discover implicit relationships (e.g., 'Person A' and 'Project X' are often mentioned together).
   */
  async findFrequentCoOccurringEntities(minOccurrences = 5, limit = 20) {
    const query = `g.V().hasLabel('entity').as('a')
      .out('appears_in').in('appears_in')
      .where(lt('a')).as('b')
      .select('a', 'b').by('text')
      .groupCount()
      .unfold()
      .where(select(values).is(gte(min)))
      .order().by(values, decr)
      .limit(l)
      .project('pair', 'coOccurrences')
        .by(select(keys))
        .by(select(values))`;
    
    const bindings = { min: minOccurrences, l: limit };
    return await cosmosClient.executeQuery(query, bindings);
  }
}

module.exports = EntitySearchService.getInstance();
