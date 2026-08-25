const PHP_RUNTIME_WARNING =
  /(?:^|\s)(?:warning|notice|deprecated|fatal error|parse error)\s*:\s*.+?\s+(?:in|on)\s+(?:\/|[A-Za-z]:\\).+?\s+(?:on\s+)?line\s+\d+\b/i;

function isSafeWarningContainer(element: Element): boolean {
  if (element.matches("body, html, form, input, textarea, select, button")) return false;
  return element.querySelector("input, textarea, select, button, form") === null;
}

/**
 * Identifies raw server-side PHP diagnostics such as:
 * "Warning: Attempt to read property ... in /var/www/... on line 55".
 * It deliberately does not match ordinary application copy or extension errors.
 */
export function isRawPhpRuntimeWarning(text: string): boolean {
  return PHP_RUNTIME_WARNING.test(text.replace(/\s+/g, " ").trim());
}

function hideWarningElement(element: Element): boolean {
  if (!isSafeWarningContainer(element) || !isRawPhpRuntimeWarning(element.textContent ?? "")) return false;
  element.setAttribute("data-jobsage-hidden-server-warning", "true");
  (element as HTMLElement).style.setProperty("display", "none", "important");
  return true;
}

function hideWarningTextNode(node: Text): boolean {
  if (!isRawPhpRuntimeWarning(node.data)) return false;
  const parent = node.parentElement;
  if (parent && isSafeWarningContainer(parent) && isRawPhpRuntimeWarning(parent.textContent ?? "")) {
    return hideWarningElement(parent);
  }
  // A warning can share a wrapper with the employer's form. Remove only the
  // diagnostic text in that case, never the wrapper or any form controls.
  node.remove();
  return true;
}

/**
 * Remove only raw PHP runtime diagnostics injected into an employer page.
 * The application form and every form control are left untouched.
 */
export function hideRawPhpRuntimeWarnings(root: ParentNode = document): number {
  let hidden = 0;

  root.querySelectorAll?.("p, div, span, pre, code, li").forEach((element) => {
    if (hideWarningElement(element)) hidden += 1;
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    if (node.parentElement?.closest("[data-jobsage-hidden-server-warning]")) continue;
    if (hideWarningTextNode(node)) hidden += 1;
  }

  return hidden;
}

/** Keep dynamic server warnings from appearing after an AJAX form step. */
export function watchRawPhpRuntimeWarnings(root: Node = document.documentElement): () => void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          hideRawPhpRuntimeWarnings(node as ParentNode);
        } else if (node.nodeType === Node.TEXT_NODE) {
          hideWarningTextNode(node as Text);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}