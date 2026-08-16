/**
 * Project-level secret redactor (per GEMINI.md). HTTP libraries stringify the
 * full request URL — including any credential query params — into exception
 * messages. Run every error string we log or send to a client through this first.
 */
const SECRET_PARAM = /([?&](?:key|api[-_]?key|access[-_]?token|auth[-_]?token|password|secret)=)[^&\s"']+/gi;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAM, "$1REDACTED");
}
