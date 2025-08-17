// entitySearchService.js
const cosmosClient = require('../shared/gremlinClient');
const QueryBuilder = require('./queryBuilder');

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
   * Finds all categories in the graph.
   * Purpose: Get a list of all top-level categories in the graph.
   * @returns {Promise<Array<string>>} - An array of strings representing the categories.
   */
  async listCategories() {
    const query = `g.V().hasLabel('entity').values('category').dedup()`;
    return await cosmosClient.executeQuery(query);
  }

  /**
   * Finds all subCategories for a given category in the graph.
   * @param {string} category - The category to search for subCategories.
   * @returns {Promise<Array<string>>} - An array of strings representing the subCategories.
   */
  async listSubCategories(category) {
    const query = `g.V().hasLabel('entity').has('category', c).values('subCategory').dedup()`;
    const bindings = { c: category };
    return await cosmosClient.executeQuery(query, bindings);
  }

  /**
   * Finds canonical entity vertices by their category and subCategory.
   * Purpose: Search for entities of a certain type (e.g., all 'Organizations' in the 'Company' subCategory).
   * @param {string} category - The top-level category of the entities to search for.
   * @param {string} subCategory - The subCategory of the entities to search for.
   * @returns {Promise<Array<{id: string, text: string, category: string, subCategory: string}>>} - An array of objects with the requested properties.
   */

  async findEntitiesByCategoryAndSubCategory(category, subCategory) {
    const query = `g.V().hasLabel('entity').has('category', c).has('subCategory', s).valueMap(true)`;
    const bindings = { c: category, s: subCategory };
    return await cosmosClient.executeQuery(query, bindings);
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

  async findDocumentsForEntity(entityText, limit = 50) {
    const query = `g.V().has('entity', 'text', entityTxt)
      .out('appears_in')
      .limit(l)
      .valueMap(true)`;
    const bindings = { entityTxt: entityText, l: limit };
    return await cosmosClient.executeQuery(query, bindings);
  }

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

  async findDocumentsForQuery(query) {
    const queryBuilder = new QueryBuilder();
    const gremlinQuery = queryBuilder.buildQueryFromKeywordString(query);

    return await cosmosClient.executeQuery(gremlinQuery);
  }
}

module.exports = EntitySearchService.getInstance();
