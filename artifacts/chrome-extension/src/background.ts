const JOBSAGE_API_BASE = "https://jobsage.co.uk/api";
const JOBSAGE_COOKIE_URL = "https://jobsage.co.uk";
const SESSION_COOKIE_NAME = "sid";

async function getSessionToken(): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: JOBSAGE_COOKIE_URL,
    name: SESSION_COOKIE_NAME,
  });
  return cookie?.value ?? null;
}

interface ApiRequestMessage {
  type: "API_REQUEST";
  endpoint: string;
  method?: string;
  body?: unknown;
}

interface GetTokenMessage {
  type: "GET_TOKEN";
}

interface PillClickedMessage {
  type: "PILL_CLICKED";
}

type IncomingMessage = ApiRequestMessage | GetTokenMessage | PillClickedMessage;

interface ApiResponseSuccess {
  data: unknown;
}

interface ApiResponseError {
  error: string;
}

interface TokenResponse {
  token: string | null;
}

type ApiResponse = ApiResponseSuccess | ApiResponseError | TokenResponse;

chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ApiResponse) => void
  ) => {
    if (message.type === "GET_TOKEN") {
      getSessionToken().then((token) => sendResponse({ token }));
      return true;
    }

    if (message.type === "PILL_CLICKED") {
      return false;
    }

    if (message.type !== "API_REQUEST") {
      return false;
    }

    const { endpoint, method = "GET", body } = message;

    (async () => {
      try {
        const token = await getSessionToken();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (body !== undefined && method !== "GET" && method !== "HEAD") {
          fetchOptions.body = JSON.stringify(body);
        }

        const url = `${JOBSAGE_API_BASE}${endpoint}`;
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const text = await response.text();
          sendResponse({ error: `HTTP ${response.status}: ${text}` });
          return;
        }

        const data = await response.json();
        sendResponse({ data });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ error: message });
      }
    })();

    return true;
  }
);
