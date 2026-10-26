import React from "react";
import { createRoot } from "react-dom/client";
import { SmartApplyExtensionBanner } from "../../src/components/SmartApplyExtensionPrompt";
import "../../src/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Smart Apply install test root is missing");

createRoot(root).render(<SmartApplyExtensionBanner />);
