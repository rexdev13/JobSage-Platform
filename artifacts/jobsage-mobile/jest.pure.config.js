module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/utils.test.js"],
  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": ["babel-jest", { configFile: "./babel.config.js" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react-native$": "<rootDir>/__mocks__/react-native-pure.js",
    "^react-native/(.*)$": "<rootDir>/__mocks__/react-native-pure.js",
  },
  testTimeout: 30000,
};
