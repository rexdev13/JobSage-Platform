module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.tsx", "**/__tests__/**/*.test.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/|(?:jest-)?react-native|@react-native|expo|@expo|react-navigation|@react-navigation|@unimodules|unimodules|test-renderer|react-reconciler|@testing-library|@workspace))",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testTimeout: 30000,
  resetModules: false,
  clearMocks: false,
  restoreMocks: false,
};
