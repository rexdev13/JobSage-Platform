import React from "react";
import { describe, it, expect, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";

let mockAuthUserRole: string | null = "candidate";

jest.mock("expo-router", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const Tabs = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, { testID: "companion-tabs" }, children);
  Tabs.Screen = () => null;
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    Link: ({ children }: { children: React.ReactNode }) => children,
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "companion-redirect", accessibilityLabel: href }, href),
    Tabs,
  };
});

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
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

jest.mock("expo-symbols", () => ({ SymbolView: () => null }));

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
  useGetMyAnalytics: () => ({
    data: {
      readinessScore: 42,
      statusBreakdown: { applied: 1, shortlisted: 0, interview: 0, offer: 0 },
    },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
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
    user: { id: "u1", email: "test@test.com", firstName: "Test", lastName: "User", role: mockAuthUserRole },
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

describe("Dashboard (index) tab", () => {
  it("renders without crashing", async () => {
    const Dashboard = require("../app/companion/index").default;
    const { getAllByText } = await render(<Dashboard />);
    expect(getAllByText(/dashboard|welcome|readiness|score/i).length).toBeGreaterThan(0);
  });
});

describe("Applications tab", () => {
  it("renders without crashing", async () => {
    const Applications = require("../app/companion/applications").default;
    const { getAllByText } = await render(<Applications />);
    expect(getAllByText(/application/i).length).toBeGreaterThan(0);
  });
});

describe("Analytics tab", () => {
  it("renders without crashing", async () => {
    const Analytics = require("../app/companion/analytics").default;
    const { getAllByText } = await render(<Analytics />);
    expect(getAllByText(/analytic|progress|readiness/i).length).toBeGreaterThan(0);
  });
});

describe("Path tab", () => {
  it("renders without crashing", async () => {
    const Path = require("../app/companion/path").default;
    const { getAllByText } = await render(<Path />);
    expect(getAllByText(/path|journey|stage/i).length).toBeGreaterThan(0);
  });
});

describe("Profile tab", () => {
  it("renders without crashing", async () => {
    const Profile = require("../app/companion/profile").default;
    const { getAllByText } = await render(<Profile />);
    expect(getAllByText(/profile|account|settings/i).length).toBeGreaterThan(0);
  });
});

describe("Login screen", () => {
  it("renders without crashing", async () => {
    const Login = require("../app/login").default;
    const { getAllByText } = await render(<Login />);
    expect(getAllByText(/sign in|log in|jobsage/i).length).toBeGreaterThan(0);
  });
});

describe("Companion role gate", () => {
  it("keeps candidate users in the native companion", async () => {
    mockAuthUserRole = "candidate";
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-tabs")).toBeTruthy();
  });

  it.each(["employer", "reviewer", "admin", "super_admin", "marketing", null])(
    "routes non-candidate role %s to the canonical workspace",
    async (role) => {
      mockAuthUserRole = role;
      const TabLayout = require("../app/companion/_layout").default;
      const { getByTestId } = await render(<TabLayout />);
      expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
    },
  );
});
