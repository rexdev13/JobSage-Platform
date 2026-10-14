import React from "react";
import { describe, it, expect, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

let mockAuthUserRole: string | null = "candidate";
let mockAuthUserId: string | null = "u1";
let mockEmployerOrganizations: unknown = { organizations: [], archivedOrganizations: [] };
let mockEmployerOrganizationsLoading = false;
let mockEmployerOrganizationsFetching = false;
let mockEmployerOrganizationsError = false;

jest.mock("expo-router", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const Tabs = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, { testID: "companion-tabs" }, children);
  Tabs.Screen = () => null;
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useURL: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "companion-redirect", accessibilityLabel: href }, href),
    Tabs,
  };
});

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
  Feather: () => null,
}));

jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: "ExponentPushToken[fixture]" })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
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
  getListEmployerOrganizationsQueryKey: () => ["/api/employer/organizations"],
  useListEmployerOrganizations: () => ({
    data: mockEmployerOrganizations,
    isLoading: mockEmployerOrganizationsLoading,
    isFetching: mockEmployerOrganizationsFetching,
    isError: mockEmployerOrganizationsError,
  }),
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
    user: { id: mockAuthUserId, email: "test@test.com", firstName: "Test", lastName: "User", role: mockAuthUserRole },
    isLoading: false,
    logout: jest.fn(),
    refetchUser: jest.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#952323",
    primaryForeground: "#ffffff",
    background: "#fdfcfc",
    foreground: "#1c1917",
    card: "#ffffff",
    text: "#1c1917",
    muted: "#f4f2f0",
    mutedForeground: "#847771",
    secondary: "#f3eae8",
    secondaryForeground: "#272320",
    border: "#e8e0de",
    accent: "#a51d1d",
    accentForeground: "#ffffff",
    radius: 12,
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4343",
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

  it("provides a working route back to the full JOBSAGE workspace", async () => {
    const Profile = require("../app/companion/profile").default;
    const { getByTestId } = await render(<Profile />);
    fireEvent.press(getByTestId("profile-open-workspace"));
    expect(require("expo-router").router.push).toHaveBeenCalledWith("/workspace");
  });
});

describe("Workspace companion navigation", () => {
  it("shows the candidate shortcut and opens the companion route", async () => {
    jest.clearAllMocks();
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    mockEmployerOrganizationsLoading = false;
    mockEmployerOrganizationsFetching = false;
    mockEmployerOrganizationsError = false;
    const { CandidateCompanionShortcut } = require("../components/CandidateCompanionShortcut");
    const { getByTestId } = await render(<CandidateCompanionShortcut role="candidate" />);
    fireEvent.press(getByTestId("workspace-companion-link"));
    expect(require("expo-router").router.push).toHaveBeenCalledWith("/companion");
  });

  it.each(["employer", "moderator", null])("does not show the shortcut for %s", async (role) => {
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    const { CandidateCompanionShortcut } = require("../components/CandidateCompanionShortcut");
    const { queryByTestId } = await render(<CandidateCompanionShortcut role={role} />);
    expect(queryByTestId("workspace-companion-link")).toBeNull();
  });

  it("does not show the shortcut while employer context is being refreshed", async () => {
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    mockEmployerOrganizationsFetching = true;
    const { CandidateCompanionShortcut } = require("../components/CandidateCompanionShortcut");
    const { queryByTestId } = await render(<CandidateCompanionShortcut role="candidate" />);
    expect(queryByTestId("workspace-companion-link")).toBeNull();
    mockEmployerOrganizationsFetching = false;
  });

  it.each([
    { organizations: [{ id: 1, companyName: "Example Care", role: "recruiter" }], archivedOrganizations: [] },
    { organizations: [], archivedOrganizations: [{ id: 2, companyName: "Archived Care", archivedAt: "2026-01-01", restoreUntil: "2026-03-01" }] },
  ])("keeps candidate-role employer users out of the companion shortcut", async (organizations) => {
    mockEmployerOrganizations = organizations;
    const { CandidateCompanionShortcut } = require("../components/CandidateCompanionShortcut");
    const { queryByTestId } = await render(<CandidateCompanionShortcut role="candidate" />);
    expect(queryByTestId("workspace-companion-link")).toBeNull();
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
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    mockEmployerOrganizationsLoading = false;
    mockEmployerOrganizationsFetching = false;
    mockEmployerOrganizationsError = false;
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-tabs")).toBeTruthy();
  });

  it.each(["employer", "moderator", "reviewer", "admin", "super_admin", "marketing", null])(
    "routes non-candidate role %s to the canonical workspace",
    async (role) => {
      mockAuthUserRole = role;
      const TabLayout = require("../app/companion/_layout").default;
      const { getByTestId } = await render(<TabLayout />);
      expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
    },
  );

  it("routes candidate-role employer staff to the canonical workspace", async () => {
    mockAuthUserRole = "candidate";
    mockEmployerOrganizations = {
      organizations: [{ id: 1, companyName: "Example Care", role: "recruiter" }],
      archivedOrganizations: [],
    };
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
  });

  it("routes candidate users to the canonical workspace if employer context cannot be checked", async () => {
    mockAuthUserRole = "candidate";
    mockAuthUserId = "u1";
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    mockEmployerOrganizationsError = true;
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
    mockEmployerOrganizationsError = false;
  });

  it("routes to the canonical workspace when employer membership data is incomplete", async () => {
    mockAuthUserRole = "candidate";
    mockEmployerOrganizations = { organizations: [] };
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
  });

  it("does not accept an anonymous identity for candidate companion access", async () => {
    mockAuthUserRole = "candidate";
    mockAuthUserId = null;
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    const TabLayout = require("../app/companion/_layout").default;
    const { getByTestId } = await render(<TabLayout />);
    expect(getByTestId("companion-redirect").props.accessibilityLabel).toBe("/workspace");
    mockAuthUserId = "u1";
  });

  it("waits for refreshed employer context before rendering companion tabs", async () => {
    mockAuthUserRole = "candidate";
    mockAuthUserId = "u1";
    mockEmployerOrganizations = { organizations: [], archivedOrganizations: [] };
    mockEmployerOrganizationsLoading = false;
    mockEmployerOrganizationsFetching = true;
    const TabLayout = require("../app/companion/_layout").default;
    const { queryByTestId } = await render(<TabLayout />);
    expect(queryByTestId("companion-tabs")).toBeNull();
    expect(queryByTestId("companion-redirect")).toBeNull();
    mockEmployerOrganizationsFetching = false;
  });
});
