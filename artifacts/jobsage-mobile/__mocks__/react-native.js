module.exports = {
  useColorScheme: () => null,
  Platform: { OS: "ios", select: (obj) => obj.ios ?? obj.default },
  StyleSheet: { create: (s) => s, flatten: (s) => s },
  Dimensions: { get: () => ({ width: 375, height: 812 }) },
};
