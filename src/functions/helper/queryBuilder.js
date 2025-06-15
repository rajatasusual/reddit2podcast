const QUERY_TEMPLATES = {
  entitySearch: `g.V().has('entity', 'text', '{entityText}')`,
  relationshipQuery: `g.V().has('entity', 'text', '{source}')
                      .outE('{relationship}').inV()`,
  coOccurrenceQuery: `g.V().has('entity', 'text', '{entity1}')
                      .both().where(eq('entity', 
                        __.has('text', '{entity2}')))`
};

class QueryBuilder {
  buildFromAnalysis(entities) {
    const primaryEntity = entities[0];

    if (entities.length > 1) {
      return this._buildRelationshipQuery(entities);
    }

    return QUERY_TEMPLATES.entitySearch
      .replace('{entityText}', primaryEntity.text);
  }

  _buildRelationshipQuery(entities) {
    const entityGraphBuilder = require("./entityGraphBuilder");

    const relType = entityGraphBuilder.determineRelationshipType(entities[0], entities[1]);

    return QUERY_TEMPLATES.relationshipQuery
      .replace('{source}', entities[0].text)
      .replace('{relationship}', relType);
  }
}

module.exports = QueryBuilder;