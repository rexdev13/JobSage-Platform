// Use the SDK-aligned native preset rather than a partial react-native stub.
const base = require("./jest.config.js");
module.exports = {
  ...base,
  testMatch: ["**/__tests__/**/*.test.tsx"],
};
