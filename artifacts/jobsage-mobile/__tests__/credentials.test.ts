import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { clearCredential, readCredential, writeCredential } from "../lib/credentials";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const get = jest.mocked(SecureStore.getItemAsync);
const set = jest.mocked(SecureStore.setItemAsync);
const remove = jest.mocked(SecureStore.deleteItemAsync);

beforeEach(async () => {
  jest.clearAllMocks();
  get.mockResolvedValue(null);
  set.mockResolvedValue();
  remove.mockResolvedValue();
  await AsyncStorage.clear();
});
afterEach(() => { jest.restoreAllMocks(); });

describe("native credential protection", () => {
  it("migrates legacy credentials and deletes plaintext plus cached identity", async () => {
    await AsyncStorage.setItem("jobsage_auth_token", "synthetic-session");
    await AsyncStorage.setItem("jobsage_auth_user", '{"id":"fixture"}');
    expect(await readCredential()).toBe("synthetic-session");
    expect(set).toHaveBeenCalledWith("jobsage_auth_token", "synthetic-session",
      { keychainAccessible: 7 });
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBeNull();
    expect(await AsyncStorage.getItem("jobsage_auth_user")).toBeNull();
  });

  it("does not erase the only credential when a protected migration fails", async () => {
    await AsyncStorage.setItem("jobsage_auth_token", "synthetic-session");
    set.mockRejectedValueOnce(new Error("keystore unavailable"));
    await expect(readCredential()).rejects.toThrow("keystore unavailable");
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBe("synthetic-session");
  });

  it("fails closed instead of falling back when the secure read fails", async () => {
    get.mockRejectedValueOnce(new Error("locked"));
    await expect(readCredential()).rejects.toThrow("locked");
    expect(set).not.toHaveBeenCalled();
  });

  it("prefers the protected credential and removes stale legacy copies", async () => {
    get.mockResolvedValueOnce("protected-session");
    await AsyncStorage.setItem("jobsage_auth_token", "old-session");
    expect(await readCredential()).toBe("protected-session");
    expect(set).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBeNull();
  });

  it("stores native credentials only in SecureStore", async () => {
    await writeCredential("synthetic-session");
    expect(set).toHaveBeenCalled();
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBeNull();
  });

  it("clears protected and legacy credentials", async () => {
    await AsyncStorage.setItem("jobsage_auth_token", "old-session");
    await clearCredential();
    expect(remove).toHaveBeenCalledWith("jobsage_auth_token", { keychainAccessible: 7 });
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBeNull();
  });

  it("keeps web-preview credentials in memory rather than browser storage", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await writeCredential("synthetic-web-session");
    expect(set).not.toHaveBeenCalled();
    expect(await readCredential()).toBe("synthetic-web-session");
    expect(await AsyncStorage.getItem("jobsage_auth_token")).toBeNull();
    await clearCredential();
    expect(await readCredential()).toBeNull();
  });
});
