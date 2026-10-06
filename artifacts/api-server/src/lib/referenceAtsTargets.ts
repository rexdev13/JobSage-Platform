export type ReferenceAtsTarget = {
  employer: string;
  provider: "greenhouse" | "lever" | "ashby";
  boardId: string;
};

/**
 * Employer/board pairs from the supplied collector reference. They are only
 * allowlist candidates: the collector runs a pair only when the existing
 * sponsor row has a uniquely matched, reviewed mapping with the same provider
 * and board ID. These entries are not employer-identity proof.
 */
export const REFERENCE_ATS_TARGETS: readonly ReferenceAtsTarget[] = [
  { provider: "greenhouse", boardId: "monzo", employer: "Monzo" },
  { provider: "greenhouse", boardId: "deliveroo", employer: "Deliveroo" },
  { provider: "greenhouse", boardId: "wise", employer: "Wise" },
  { provider: "greenhouse", boardId: "gocardless", employer: "GoCardless" },
  { provider: "greenhouse", boardId: "cloudflare", employer: "Cloudflare" },
  { provider: "greenhouse", boardId: "stripe", employer: "Stripe" },
  { provider: "greenhouse", boardId: "gitlab", employer: "GitLab" },
  { provider: "greenhouse", boardId: "elastic", employer: "Elastic" },
  { provider: "greenhouse", boardId: "datadog", employer: "Datadog" },
  { provider: "greenhouse", boardId: "mongodb", employer: "MongoDB" },
  { provider: "greenhouse", boardId: "airbnb", employer: "Airbnb" },
  { provider: "greenhouse", boardId: "dropbox", employer: "Dropbox" },
  { provider: "greenhouse", boardId: "figma", employer: "Figma" },
  { provider: "greenhouse", boardId: "twilio", employer: "Twilio" },
  { provider: "greenhouse", boardId: "okta", employer: "Okta" },
  { provider: "greenhouse", boardId: "thoughtworks", employer: "Thoughtworks" },
  { provider: "greenhouse", boardId: "duolingo", employer: "Duolingo" },
  { provider: "greenhouse", boardId: "reddit", employer: "Reddit" },
  { provider: "greenhouse", boardId: "pinterest", employer: "Pinterest" },
  { provider: "greenhouse", boardId: "robinhood", employer: "Robinhood" },
  { provider: "greenhouse", boardId: "coinbase", employer: "Coinbase" },
  { provider: "greenhouse", boardId: "affirm", employer: "Affirm" },
  { provider: "greenhouse", boardId: "brex", employer: "Brex" },
  { provider: "greenhouse", boardId: "gusto", employer: "Gusto" },
  { provider: "greenhouse", boardId: "databricks", employer: "Databricks" },
  { provider: "greenhouse", boardId: "samsara", employer: "Samsara" },
  { provider: "greenhouse", boardId: "anthropic", employer: "Anthropic" },
  { provider: "greenhouse", boardId: "discord", employer: "Discord" },
  { provider: "greenhouse", boardId: "asana", employer: "Asana" },
  { provider: "greenhouse", boardId: "squarespace", employer: "Squarespace" },
  { provider: "greenhouse", boardId: "klaviyo", employer: "Klaviyo" },
  { provider: "greenhouse", boardId: "instacart", employer: "Instacart" },
  { provider: "lever", boardId: "palantir", employer: "Palantir" },
  { provider: "lever", boardId: "spotify", employer: "Spotify" },
  { provider: "lever", boardId: "zopa", employer: "Zopa" },
  { provider: "lever", boardId: "matchgroup", employer: "Match Group" },
  { provider: "ashby", boardId: "ramp", employer: "Ramp" },
  { provider: "ashby", boardId: "notion", employer: "Notion" },
  { provider: "ashby", boardId: "openai", employer: "OpenAI" },
  { provider: "ashby", boardId: "linear", employer: "Linear" },
  { provider: "ashby", boardId: "multiverse", employer: "Multiverse" },
  { provider: "ashby", boardId: "synthesia", employer: "Synthesia" },
  { provider: "ashby", boardId: "elevenlabs", employer: "ElevenLabs" },
  { provider: "ashby", boardId: "cursor", employer: "Cursor" },
  { provider: "ashby", boardId: "perplexity", employer: "Perplexity" },
  { provider: "ashby", boardId: "replit", employer: "Replit" },
  { provider: "ashby", boardId: "supabase", employer: "Supabase" },
  { provider: "ashby", boardId: "benchling", employer: "Benchling" },
  { provider: "ashby", boardId: "wayve", employer: "Wayve" },
];
