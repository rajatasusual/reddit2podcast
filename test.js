const QueryBuilder = require("./src/functions/helper/queryBuilder");
const gremlinClient = require("./src/functions/shared/gremlinClient");

const queryBuilder = new QueryBuilder();

const queries = [
  "Tesla",

  "category:Organization",

  "subCategory:\"mobile devices\"",

  "laptop electronics",

  "laptop AND electronics",

  "laptop OR tablet",

  "NOT tablet",

  "(laptop OR tablet) AND NOT phone",

  "category:electronics AND subCategory:computers",

  "category:\"home appliances\" AND refrigerator",

  "NOT (category:electronics AND tablet) OR phone",

  "(category:electronics AND subCategory:\"mobile devices\") OR (type:accessory AND NOT charger)",

  "category:electronics laptop",

  "((laptop AND tablet) OR (phone AND NOT charger)) AND category:electronics",

  "phone category:telecom",

  "category:books AND NOT \"science fiction\"",

  "category:books and not \"science fiction\"",

  "type:fiction",

  "( category : books ) AND ( \"Harry Potter\" OR \"Lord of the Rings\" )",

  "subCategory:books-123",

  "\"new\" category:novel",

  "category:electronics.v2",

  "high-end_devices"
];

async function main() {
  for (const query of queries) {
    console.log("Query:", query);
    try {
      const gremlinQuery = queryBuilder.buildQueryFromKeywordString(query);
      console.log(gremlinQuery);

      const result = await gremlinClient.executeQuery(gremlinQuery);
      console.log(result);
    } catch (error) {
      console.log("Query Error:", error);
    }
  }

  gremlinClient.close();
}

main();