const nearley = require('nearley');
const moo = require('moo');

class QueryBuilder {
  constructor() {
    this._initializeGrammar();
  }

  buildQueryFromKeywordString(queryString, limit = 50) {
    const ast = this._parse(queryString);
    if (!ast) {
      return "g.V().none()";
    }

    const whereTraversal = this._astToGremlinTraversal(ast);
    return `g.V().hasLabel('document').where(${whereTraversal}).dedup().limit(${limit}).valueMap(true)`;
  }

  _initializeGrammar() {
    const lexer = moo.compile({
      WS: { match: /\s+/, lineBreaks: true },
      lparen: '(',
      rparen: ')',
      colon: ':',
      AND: { match: /\b(?:AND|and)\b/ },
      OR: { match: /\b(?:OR|or)\b/ },
      NOT: { match: /\b(?:NOT|not)\b/ },
      category: 'category',
      subCategory: 'subCategory',
      type: 'type',
      quotedString: {
        match: /"(?:[^"\\]|\\.)*"/,
        value: s => s.slice(1, -1)
      },
      identifier: /[a-zA-Z0-9._-]+/
    });

    const grammarRules = [
      { name: 'main', symbols: ['_', 'expression', '_'], postprocess: d => d[1] },
      { name: 'expression', symbols: ['expression', '_', 'OR', '_', 'andExpression'], postprocess: d => ({ type: 'OR', left: d[0], right: d[4] }) },
      { name: 'expression', symbols: ['andExpression'], postprocess: d => d[0] },
      { name: 'andExpression', symbols: ['andExpression', '_', 'AND', '_', 'notExpression'], postprocess: d => ({ type: 'AND', left: d[0], right: d[4] }) },
      { name: 'andExpression', symbols: ['andExpression', '__', 'notExpression'], postprocess: d => ({ type: 'AND', left: d[0], right: d[2] }) },
      { name: 'andExpression', symbols: ['notExpression'], postprocess: d => d[0] },
      { name: 'notExpression', symbols: ['NOT', '__', 'atom'], postprocess: d => ({ type: 'NOT', operand: d[2] }) },
      { name: 'notExpression', symbols: ['atom'], postprocess: d => d[0] },
      { name: 'atom', symbols: ['lparen', '_', 'expression', '_', 'rparen'], postprocess: d => d[2] },
      { name: 'atom', symbols: ['term'], postprocess: d => d[0] },
      { name: 'term', symbols: ['fieldSearch'], postprocess: d => d[0] },
      { name: 'term', symbols: ['quotedString'], postprocess: d => ({ type: 'TERM', field: 'text', value: d[0] }) },
      { name: 'term', symbols: ['identifier'], postprocess: d => ({ type: 'TERM', field: 'text', value: d[0] }) },
      { name: 'fieldSearch', symbols: ['fieldName', '_', 'colon', '_', 'fieldValue'], postprocess: d => ({ type: 'TERM', field: d[0], value: d[4] }) },
      { name: 'fieldName', symbols: ['category'], postprocess: () => 'category' },
      { name: 'fieldName', symbols: ['subCategory'], postprocess: () => 'subCategory' },
      { name: 'fieldName', symbols: ['type'], postprocess: () => 'type' },
      { name: 'fieldValue', symbols: ['quotedString'], postprocess: d => d[0] },
      { name: 'fieldValue', symbols: ['identifier'], postprocess: d => d[0] },
      { name: 'OR', symbols: [{ type: 'OR' }], postprocess: d => d[0].value },
      { name: 'AND', symbols: [{ type: 'AND' }], postprocess: d => d[0].value },
      { name: 'NOT', symbols: [{ type: 'NOT' }], postprocess: d => d[0].value },
      { name: 'lparen', symbols: [{ type: 'lparen' }], postprocess: d => d[0].value },
      { name: 'rparen', symbols: [{ type: 'rparen' }], postprocess: d => d[0].value },
      { name: 'colon', symbols: [{ type: 'colon' }], postprocess: d => d[0].value },
      { name: 'category', symbols: [{ type: 'category' }], postprocess: d => d[0].value },
      { name: 'subCategory', symbols: [{ type: 'subCategory' }], postprocess: d => d[0].value },
      { name: 'type', symbols: [{ type: 'type' }], postprocess: d => d[0].value },
      { name: 'quotedString', symbols: [{ type: 'quotedString' }], postprocess: d => d[0].value },
      { name: 'identifier', symbols: [{ type: 'identifier' }], postprocess: d => d[0].value },
      { name: '_', symbols: [], postprocess: () => null },
      { name: '_', symbols: [{ type: 'WS' }], postprocess: () => null },
      { name: '__', symbols: [{ type: 'WS' }], postprocess: () => null }
    ];

    this.grammar = nearley.Grammar.fromCompiled({
      Lexer: lexer,
      ParserRules: grammarRules,
      ParserStart: 'main'
    });

  }

  _parse(queryString) {
    if (!queryString || typeof queryString !== 'string') {
      return null;
    }

    try {
      const parser = new nearley.Parser(this.grammar);
      parser.feed(queryString.trim());
      if (parser.results.length === 0) return null;
      return parser.results[0]; // no ambiguity
    } catch (error) {
      console.error('Parse error:', error.message);
      return null;
    }
  }

  _astToGremlinTraversal(node) {
    if (!node) return "";

    switch (node.type) {
      case 'AND':
        return `__.and(${this._astToGremlinTraversal(node.left)}, ${this._astToGremlinTraversal(node.right)})`;
      case 'OR':
        return `__.or(${this._astToGremlinTraversal(node.left)}, ${this._astToGremlinTraversal(node.right)})`;
      case 'NOT':
        return `__.not(${this._astToGremlinTraversal(node.operand)})`;
      case 'TERM':
        const val = this._escapeGremlinString(node.value);
        return node.field === 'text'
          ? `__.in('appears_in').has('text', '${val}')`
          : `__.in('appears_in').has('${node.field}', '${val}')`;
      default:
        throw new Error(`Unknown AST node type: ${node.type}`);
    }
  }

  _escapeGremlinString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}

module.exports = QueryBuilder;
