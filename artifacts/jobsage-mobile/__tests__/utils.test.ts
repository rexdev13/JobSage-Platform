import colors from "../constants/colors";
import { useColors } from "../hooks/useColors";

describe("colors constants", () => {
  it("exports light and dark palettes", () => {
    expect(colors.light).toBeDefined();
    expect(colors.dark).toBeDefined();
  });

  it("light palette has required color tokens", () => {
    const required = ["text", "background", "primary", "secondary", "muted", "accent", "destructive", "border"];
    for (const key of required) {
      expect(colors.light).toHaveProperty(key);
      expect(typeof colors.light[key as keyof typeof colors.light]).toBe("string");
    }
  });

  it("dark palette has required color tokens", () => {
    const required = ["text", "background", "primary", "secondary", "muted", "accent", "destructive", "border"];
    for (const key of required) {
      expect(colors.dark).toHaveProperty(key);
      expect(typeof colors.dark[key as keyof typeof colors.dark]).toBe("string");
    }
  });

  it("light text and background are accessible contrast (dark text on light bg)", () => {
    expect(colors.light.text).toBe("#0f172a");
    expect(colors.light.background).toBe("#f8fafc");
  });

  it("dark text and background are accessible contrast (light text on dark bg)", () => {
    expect(colors.dark.text).toBe("#f8fafc");
    expect(colors.dark.background).toBe("#0f172a");
  });

  it("tint colour is the same in both palettes (brand consistency)", () => {
    expect(colors.light.tint).toBe(colors.dark.tint);
  });

  it("accent colour matches tint (brand primary is sky-500)", () => {
    expect(colors.light.accent).toBe(colors.light.tint);
    expect(colors.dark.accent).toBe(colors.dark.tint);
  });

  it("destructive colour is red in both palettes", () => {
    expect(colors.light.destructive).toBe("#ef4444");
    expect(colors.dark.destructive).toBe("#ef4444");
  });

  it("radius is a positive number", () => {
    expect(typeof colors.radius).toBe("number");
    expect(colors.radius).toBeGreaterThan(0);
  });
});

describe("useColors hook (unit)", () => {
  it("returns light palette when color scheme is null (default)", () => {
    const palette = useColors();
    expect(palette.text).toBe(colors.light.text);
    expect(palette.background).toBe(colors.light.background);
  });

  it("includes radius in returned palette", () => {
    const palette = useColors();
    expect(palette.radius).toBe(colors.radius);
  });

  it("all token values are non-empty strings or numbers", () => {
    const palette = useColors();
    for (const [key, value] of Object.entries(palette)) {
      if (key === "radius") {
        expect(typeof value).toBe("number");
      } else {
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
    }
  });
});
