// entitySearchService.js
const cosmosClient = require('../shared/gremlinClient');

class EntitySearchService {
  constructor() {
    if (EntitySearchService.instance) {
      throw new Error('Singleton instantiation attempted.');
    }
    EntitySearchService.instance = this;
  }

  static getInstance() {
    if (!EntitySearchService.instance) {
      EntitySearchService.instance = new EntitySearchService();
    }
    return EntitySearchService.instance;
  }

  async findEntitiesByCategory(category, limit = 100) {
    const query = `g.V().hasLabel('entity')
      .has('category', '${category}')
      .order().by('confidenceScore')
      .limit(${limit})
      .valueMap(true)`;

    return await cosmosClient.executeQuery(query);
  }

  async findRelatedEntities(entityText, maxHops = 2, limit = 50) {
    const query = `g.V().hasLabel('entity')
      .has('text', '${this.escapeString(entityText)}')
      .repeat(both().simplePath())
      .times(${maxHops})
      .hasLabel('entity')
      .dedup()
      .limit(${limit})
      .valueMap(true)`;

    return await cosmosClient.executeQuery(query);
  }

  async findEntitiesInDocument(documentId) {
    const query = `g.V().hasLabel('entity')
      .has('documentId', '${documentId}')
      .order().by('offset')
      .valueMap(true)`;

    return await cosmosClient.executeQuery(query);
  }

  async findFrequentEntityPairs(minOccurrences = 5) {
    // 1. Execute a query that returns a flat list of connected entity text pairs.
    // This query projects the text of the out-vertex and in-vertex for each 'co_occurs' edge.
    // The result is a stream of simple map objects, which are easily serialized.
    const query = `g.E().hasLabel('co_occurs').project('out_v', 'in_v').by(outV().values('text')).by(inV().values('text'))`;

    const pairs = await cosmosClient.executeQuery(query);

    // 2. Process the results in your JavaScript code to count the occurrences.
    const pairCounts = new Map();

    for (const pair of pairs) {
      // Create a canonical key by sorting the entity names alphabetically.
      // This ensures that ('Entity A', 'Entity B') and ('Entity B', 'Entity A') are treated as the same pair.
      const canonicalKey = [pair.out_v, pair.in_v].sort().join(' <--> ');

      const currentCount = pairCounts.get(canonicalKey) || 0;
      pairCounts.set(canonicalKey, currentCount + 1);
    }

    // 3. Filter and format the results based on the minimum occurrences.
    const frequentPairs = [];
    for (const [pairKey, count] of pairCounts.entries()) {
      if (count >= minOccurrences) {
        const [entity1, entity2] = pairKey.split(' <--> ');
        frequentPairs.push({
          pair: { entity1, entity2 },
          count: count
        });
      }
    }

    // Sort by count descending for relevance
    return frequentPairs.sort((a, b) => b.count - a.count);
  }

  async searchEntitiesByTextPattern(pattern, category = null) {
    let query = `g.V().hasLabel('entity')`;

    if (category) {
      query += `.has('category', '${category}')`;
    }

    query += `.has('text', containing('${this.escapeString(pattern)}'))
      .order().by('confidenceScore')
      .limit(100)
      .valueMap(true)`;

    return await cosmosClient.executeQuery(query);
  }

  escapeString(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
  }
}

module.exports = EntitySearchService.getInstance();

