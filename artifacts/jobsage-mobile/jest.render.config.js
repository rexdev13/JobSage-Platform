/**
 * Jest config for React Native render tests (tabs.test.tsx).
 * Uses babel-preset-expo for transformation and overrides transformIgnorePatterns
 * to handle pnpm's .pnpm/ symlink structure where packages live at paths like
 *   node_modules/.pnpm/react-native@0.81.5_.../node_modules/react-native
 * The default jest-expo preset only matches top-level node_modules/<pkg> but pnpm
 * stores actual files deeper, so we must allow transformation of .pnpm/* subtrees.
 */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/tabs.test.tsx"],
  transform: {
    "^.+\\.(ts|tsx|js|jsx)$": [
      "babel-jest",
      { configFile: "./babel.config.js" },
    ],
  },
  transformIgnorePatterns: [
    // Allow babel-jest to transform packages inside pnpm's .pnpm/ store AND
    // top-level react-native / expo symlinks.
    "node_modules/(?!(?:\\.pnpm/)?(?:react-native|@react-native|expo|@expo|@unimodules|@workspace|react-navigation|@react-navigation|react-native-svg|react-native-reanimated|react-native-gesture-handler|react-native-screens|react-native-safe-area-context|react-native-keyboard-controller|react-native-worklets))",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // The test file itself mocks react-native inline via jest.mock(), but any
    // transitive import that resolves react-native directly still needs a stub.
    "^react-native$": "<rootDir>/__mocks__/react-native.js",
  },
  setupFiles: ["<rootDir>/__mocks__/setup.js"],
  testTimeout: 30000,
};
