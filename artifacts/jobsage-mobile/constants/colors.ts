const launchColors = {
  launchBackground: "#f8eee8",
  launchCard: "#fffaf6",
  launchBorder: "#eadbd2",
  launchText: "#69323b",
  launchMuted: "#847771",
};

const colors = {
  light: {
    ...launchColors,
    text: "#1c1917",
    tint: "#a51d1d",
    background: "#fdfcfc",
    foreground: "#1c1917",
    card: "#ffffff",
    cardForeground: "#1c1917",
    primary: "#952323",
    primaryForeground: "#ffffff",
    secondary: "#f3eae8",
    secondaryForeground: "#272320",
    muted: "#f4f2f0",
    mutedForeground: "#847771",
    accent: "#a51d1d",
    accentForeground: "#ffffff",
    destructive: "#ef4343",
    destructiveForeground: "#ffffff",
    border: "#e8e0de",
    input: "#e8e0de",
  },

  dark: {
    ...launchColors,
    text: "#f5f2f0",
    tint: "#a51d1d",
    background: "#141110",
    foreground: "#f5f2f0",
    card: "#1c1917",
    cardForeground: "#f5f2f0",
    primary: "#952323",
    primaryForeground: "#ffffff",
    secondary: "#f3eae8",
    secondaryForeground: "#272320",
    muted: "#272320",
    mutedForeground: "#9c918b",
    accent: "#a51d1d",
    accentForeground: "#ffffff",
    destructive: "#ef4343",
    destructiveForeground: "#ffffff",
    border: "#2d2725",
    input: "#2d2725",
  },

  radius: 12,
};

export default colors;
