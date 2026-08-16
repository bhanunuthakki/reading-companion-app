import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/redact";

describe("redactSecrets", () => {
  it("masks an api key in a URL", () => {
    const masked = redactSecrets("GET https://api.example.com/v1?key=AIzaSyVERYSECRET&x=1 failed");
    expect(masked).not.toContain("AIzaSyVERYSECRET");
    expect(masked).toContain("key=REDACTED");
    expect(masked).toContain("x=1");
  });

  it("leaves clean text untouched", () => {
    expect(redactSecrets("Session not open.")).toBe("Session not open.");
  });
});
