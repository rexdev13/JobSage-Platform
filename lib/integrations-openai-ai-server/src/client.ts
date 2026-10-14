import OpenAI from "openai";
import { getOpenAIClientOptions } from "./providerConfig.js";

export const openai = new OpenAI(getOpenAIClientOptions());
