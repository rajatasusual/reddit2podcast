// local-test.js
require('dotenv').config();
const context = {
  log: console.log,
  env: "TEST",
  skip: {
    breakafterone: true,
    subreddits: false,
    threads: false,
    cleanThreads: false,
    contentAnalysis: false,
    ssml: false,
    synthesis: false
  }
};

// Import the process function directly
const { reddit2podcast } = require('./src/functions/main'); 
(async () => {
  try {
    await reddit2podcast(context);
    console.log("Test run completed successfully.");
  } catch (err) {
    console.error("Test run failed:", err);
  }
})();
