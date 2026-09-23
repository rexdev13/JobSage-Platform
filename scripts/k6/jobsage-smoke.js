import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.K6_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/+$/, "");
const profile = (__ENV.K6_PROFILE || "smoke").toLowerCase();
const runEligibility = __ENV.K6_RUN_ELIGIBILITY === "true";
const email = __ENV.K6_TEST_EMAIL || "";
const password = __ENV.K6_TEST_PASSWORD || "";

function endpoint(path) {
  return `${baseUrl}${path}`;
}

function profileStages(name) {
  const profiles = {
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
    },
    "100": {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 25 },
        { duration: "1m", target: 100 },
        { duration: "1m", target: 0 },
      ],
    },
    "1000": {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "2m", target: 1000 },
        { duration: "2m", target: 1000 },
        { duration: "1m", target: 0 },
      ],
    },
    "10000": {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "2m", target: 500 },
        { duration: "5m", target: 10000 },
        { duration: "5m", target: 10000 },
        { duration: "2m", target: 0 },
      ],
    },
    "100k": {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10m", target: 10000 },
        { duration: "20m", target: 100000 },
        { duration: "20m", target: 100000 },
        { duration: "10m", target: 0 },
      ],
    },
    "1m": {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30m", target: 100000 },
        { duration: "60m", target: 1000000 },
        { duration: "30m", target: 1000000 },
        { duration: "30m", target: 0 },
      ],
    },
  };
  return profiles[name] || profiles.smoke;
}

export const options = {
  scenarios: {
    journey: {
      ...profileStages(profile),
      exec: "journey",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2500"],
    checks: ["rate>0.99"],
  },
  noCookiesReset: true,
  tags: {
    app: "jobsage",
    profile,
  },
};

function jsonHeaders() {
  return { headers: { "Content-Type": "application/json" } };
}

function loginOnce() {
  if (!email || !password) return false;
  const response = http.post(
    endpoint("/auth/login"),
    JSON.stringify({ email, password }),
    jsonHeaders(),
  );
  const loggedIn = check(response, {
    "login is accepted": (res) => res.status === 200,
  });
  if (loggedIn) {
    const session = response.cookies.sid?.[0]?.value;
    if (session) {
      http.cookieJar().set(baseUrl, "sid", session, { path: "/" });
    }
  }
  return loggedIn;
}

export function journey() {
  check(http.get(endpoint("/healthz"), { tags: { journey: "health" } }), {
    "healthz is 200": (response) => response.status === 200,
  });

  if (__ITER === 0) loginOnce();

  const user = http.get(endpoint("/auth/user"), { tags: { journey: "auth" } });
  check(user, {
    "auth bootstrap responds": (response) => [200, 401].includes(response.status),
  });

  if (email && password) {
    const roles = http.get(endpoint("/roles?source=job_board"), {
      tags: { journey: "opportunities", source: "job_board" },
    });
    check(roles, {
      "job-board opportunities respond": (response) => response.status === 200,
    });

    const companyRoles = http.get(endpoint("/roles?source=company_site"), {
      tags: { journey: "opportunities", source: "company_site" },
    });
    check(companyRoles, {
      "company-site opportunities respond": (response) => response.status === 200,
    });

    const history = http.get(endpoint("/eligibility/history"), {
      tags: { journey: "browse", resource: "eligibility_history" },
    });
    check(history, {
      "eligibility history responds": (response) => response.status === 200,
    });

    if (runEligibility) {
      const evaluation = http.post(
        endpoint("/eligibility/evaluate"),
        JSON.stringify({}),
        jsonHeaders(),
      );
      check(evaluation, {
        "eligibility evaluation responds": (response) =>
          [200, 201, 400, 409].includes(response.status),
      });
    }
  }

  sleep(1);
}