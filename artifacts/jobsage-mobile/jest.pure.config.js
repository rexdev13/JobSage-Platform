module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/utils.test.ts", "**/__tests__/utils.test.js", "**/__tests__/tabs.smoke.test.ts"],
  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": ["babel-jest", { configFile: "./babel.config.js" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react-native$": "<rootDir>/__mocks__/react-native.js",
    "^react-native/(.*)$": "<rootDir>/__mocks__/react-native.js",
  },
  testTimeout: 30000,
};
