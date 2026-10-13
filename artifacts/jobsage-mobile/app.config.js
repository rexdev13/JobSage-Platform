const appJson = require("./app.json");
const { applyUniversalLinkConfig } = require("./scripts/deep-link-config.cjs");

module.exports = ({ config } = {}) =>
  applyUniversalLinkConfig(config || appJson.expo, process.env);
