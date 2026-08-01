import OpenAI from "openai";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

const _client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Emergency kill-switch: set AI_DISABLED=true to block every outbound AI call.
// Remove this env var (or set it to anything other than "true") to re-enable.
export const openai = process.env.AI_DISABLED === "true"
  ? new Proxy(_client, {
      get(_target, prop) {
        return () => {
          throw new Error(`[AI_DISABLED] All AI calls are disabled. Blocked call to openai.${String(prop)}`);
        };
      },
    })
  : _client;
