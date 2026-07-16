import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  notificationAsync: jest.fn(),
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("react-native-svg", () => {
  const React = require("react");
  const View = require("react-native").View;
  const mock = ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children);
  return {
    __esModule: true,
    default: mock,
    Svg: mock,
    Circle: mock,
    G: mock,
    Path: mock,
    Rect: mock,
    Defs: mock,
    LinearGradient: mock,
    Stop: mock,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("@workspace/api-client-react", () => ({
  useGetMyAnalytics: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
  useListMyApplications: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
  useGetJourneyStatus: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
  useGetMyProfile: () => ({ data: null, isLoading: false, error: null, refetch: jest.fn() }),
  useGetEligibilityDecisions: () => ({ data: null, isLoading: false, error: null }),
  useLogout: () => ({ mutateAsync: jest.fn() }),
  useLoginWithEmail: () => ({ mutateAsync: jest.fn(), isPending: false }),
  getGetJourneyStatusQueryKey: () => ["journey"],
  setBaseUrl: jest.fn(),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@test.com", firstName: "Test", lastName: "User", role: "candidate" },
    isLoading: false,
    logout: jest.fn(),
    refetchUser: jest.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0ea5e9",
    background: "#ffffff",
    card: "#f8fafc",
    text: "#0f172a",
    subtext: "#64748b",
    border: "#e2e8f0",
    accent: "#6366f1",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    inputBg: "#f1f5f9",
    tabBar: "#ffffff",
    tabBarBorder: "#e2e8f0",
  }),
}));

jest.mock("expo-constants", () => ({
  default: { expoConfig: { extra: {} } },
}));

jest.mock("react-native/Libraries/Animated/NativeAnimatedHelper");

describe("Dashboard (index) tab", () => {
  it("renders without crashing", async () => {
    const Dashboard = require("../app/(tabs)/index").default;
    const { getByText } = render(<Dashboard />);
    expect(getByText(/dashboard|welcome|readiness|score/i)).toBeTruthy();
  });
});

describe("Applications tab", () => {
  it("renders without crashing", async () => {
    const Applications = require("../app/(tabs)/applications").default;
    const { getByText } = render(<Applications />);
    expect(getByText(/application/i)).toBeTruthy();
  });
});

describe("Analytics tab", () => {
  it("renders without crashing", async () => {
    const Analytics = require("../app/(tabs)/analytics").default;
    const { getByText } = render(<Analytics />);
    expect(getByText(/analytic|progress|readiness/i)).toBeTruthy();
  });
});

describe("Path tab", () => {
  it("renders without crashing", async () => {
    const Path = require("../app/(tabs)/path").default;
    const { getByText } = render(<Path />);
    expect(getByText(/path|journey|stage/i)).toBeTruthy();
  });
});

describe("Profile tab", () => {
  it("renders without crashing", async () => {
    const Profile = require("../app/(tabs)/profile").default;
    const { getByText } = render(<Profile />);
    expect(getByText(/profile|account|settings/i)).toBeTruthy();
  });
});

describe("Login screen", () => {
  it("renders without crashing", async () => {
    const Login = require("../app/login").default;
    const { getByText } = render(<Login />);
    expect(getByText(/sign in|log in|jobsage/i)).toBeTruthy();
  });
});
