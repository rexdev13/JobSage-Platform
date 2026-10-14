import OpenAI from "openai";

export function getOpenAIClientOptions(
  env: NodeJS.ProcessEnv = process.env,
): ConstructorParameters<typeof OpenAI>[0] {
  const developmentProviderCallsDisabled =
    env.NODE_ENV === "development"
    && env.ENABLE_DEVELOPMENT_EXTERNAL_PROVIDERS !== "true";

  if (!developmentProviderCallsDisabled && !env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  if (!developmentProviderCallsDisabled && !env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  return {
    apiKey: developmentProviderCallsDisabled
      ? "development-provider-disabled"
      : env.AI_INTEGRATIONS_OPENAI_API_KEY!,
    baseURL: developmentProviderCallsDisabled
      ? "http://127.0.0.1:9/v1"
      : env.AI_INTEGRATIONS_OPENAI_BASE_URL!,
    ...(developmentProviderCallsDisabled ? { timeout: 500, maxRetries: 0 } : {}),
  };
}
