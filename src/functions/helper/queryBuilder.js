class QueryBuilder {
  buildEpisodeSearchQuery(entities, limit = 50) {
    if (!entities || entities.length === 0) {
      // Return a query that yields no results if no entities are provided.
      return "g.V().none()";
    }

    let baseQuery = `g.V().has('category', 'document')`;

    for (const entity of entities) {
      const sanitizedText = this._escapeGremlinString(entity.text);

      const whereClause = `.where(__.in('appears_in').has('entity', 'text', '${sanitizedText}'))`;
      baseQuery += whereClause;
    }

    baseQuery += `.dedup().limit(${limit}).valueMap(true)`;

    return baseQuery;
  }

  /**
   * Escapes single quotes in a string for safe inclusion in a Gremlin query.
   * @param {string} str - The string to escape.
   * @returns {string} The escaped string.
   */
  _escapeGremlinString(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'");
  }
}

module.exports = QueryBuilder;