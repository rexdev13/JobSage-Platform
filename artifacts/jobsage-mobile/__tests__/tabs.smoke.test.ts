import { describe, it, expect } from "@jest/globals";
import path from "path";
import fs from "fs";

const TABS_DIR = path.resolve(__dirname, "../app/(tabs)");
const APP_DIR = path.resolve(__dirname, "../app");

function tabFile(name: string) {
  return path.join(TABS_DIR, name);
}

describe("Mobile tab screen files — module existence smoke tests", () => {
  it("Dashboard tab (index.tsx) exists and is non-empty", () => {
    const file = tabFile("index.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content.length).toBeGreaterThan(50);
    expect(content).toMatch(/export default/);
  });

  it("Applications tab exists and exports a default component", () => {
    const file = tabFile("applications.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/export default/);
  });

  it("Analytics tab exists and exports a default component", () => {
    const file = tabFile("analytics.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/export default/);
  });

  it("Path tab exists and exports a default component", () => {
    const file = tabFile("path.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/export default/);
  });

  it("Profile tab exists and exports a default component", () => {
    const file = tabFile("profile.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/export default/);
  });

  it("Tab layout (_layout.tsx) exists", () => {
    const file = tabFile("_layout.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("Login screen exists and exports a default component", () => {
    const file = path.join(APP_DIR, "login.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/export default/);
  });

  it("Login screen references sign-in UI elements", () => {
    const file = path.join(APP_DIR, "login.tsx");
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/email|password|sign.?in|log.?in/i);
  });

  it("Dashboard tab references core candidate UI concepts", () => {
    const file = tabFile("index.tsx");
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/dashboard|readiness|score|eligible|welcome/i);
  });

  it("All tab screens import from react-native or expo ecosystem", () => {
    const tabScreens = ["index.tsx", "applications.tsx", "profile.tsx"];
    for (const screen of tabScreens) {
      const file = tabFile(screen);
      const content = fs.readFileSync(file, "utf8");
      expect(content).toMatch(/from ['"]react-native|from ['"]expo/);
    }
  });
});
