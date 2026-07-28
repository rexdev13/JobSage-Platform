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

type IncomingMessage = ApiRequestMessage | GetTokenMessage;

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

// Long-lived port relay for the streaming assistant endpoint. The content
// script cannot fetch the API directly (its requests carry the host page's
// origin and are blocked by CORS), so the sidebar connects a port and the
// service worker performs the SSE fetch, relaying chunks back.
interface AssistantStreamRequest {
  message: string;
}

type AssistantStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "error"; kind: "auth" | "server" | "network"; status?: number; message?: string }
  | { type: "done" };

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "assistant-stream") return;

  let aborted = false;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => {
    aborted = true;
    controller.abort();
  });

  const post = (event: AssistantStreamEvent) => {
    if (!aborted) {
      try {
        port.postMessage(event);
      } catch {
        aborted = true;
      }
    }
  };

  port.onMessage.addListener((request: AssistantStreamRequest) => {
    (async () => {
      const token = await getSessionToken();
      if (!token) {
        post({ type: "error", kind: "auth" });
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${JOBSAGE_API_BASE}/smart-apply/assistant`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: request.message }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          post({ type: "error", kind: "network", message: (err as Error).message });
        }
        return;
      }

      if (response.status === 401 || response.status === 403) {
        post({ type: "error", kind: "auth", status: response.status });
        return;
      }
      if (!response.ok || !response.body) {
        let message: string | undefined;
        try {
          const parsed = (await response.json()) as { error?: string };
          message = parsed.error;
        } catch {
          // non-JSON error body
        }
        post({ type: "error", kind: "server", status: response.status, message });
        return;
      }

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as { text?: string; error?: string };
              if (payload.error) {
                post({ type: "error", kind: "server", message: payload.error });
              } else if (payload.text) {
                post({ type: "chunk", text: payload.text });
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
        post({ type: "done" });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          post({ type: "error", kind: "network", message: (err as Error).message });
        }
      }
    })();
  });
});

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
