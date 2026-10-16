// Open-redirect protection for post-sign-in and post-MFA navigation (website and console).
import { CONSOLE_RETURN_PATHS, safeReturnPath, WEB_RETURN_PATHS } from "@sj/contracts";
import { describe, expect, it } from "vitest";

describe("safeReturnPath", () => {
  const web = (n: string | null) => safeReturnPath(n, WEB_RETURN_PATHS, "/status");
  const con = (n: string | null) => safeReturnPath(n, CONSOLE_RETURN_PATHS, "/");

  it("keeps approved internal destinations, including sub-paths, query and fragment", () => {
    expect(web("/register")).toBe("/register");
    expect(web("/status?tab=2027")).toBe("/status?tab=2027");
    expect(web("/activate#code")).toBe("/activate#code");
    expect(con("/users/2f1c6a7e-0000-4000-8000-000000000000")).toBe("/users/2f1c6a7e-0000-4000-8000-000000000000");
    expect(con("/applications?edition=2027&status=submitted")).toBe("/applications?edition=2027&status=submitted");
    expect(con("/")).toBe("/");
  });

  it.each([
    ["absolute URL", "https://evil.example/phish"],
    ["scheme-relative", "//evil.example/phish"],
    ["backslash trick", "/\\evil.example"],
    ["backslash variant", "\\\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["encoded slashes", "/%2F%2Fevil.example"],
    ["tab inside scheme", "/\t/evil.example"],
    ["newline", "/status\n//evil.example"],
    ["no leading slash", "evil.example"],
    ["dot-segment escape to unlisted page", "/status/../admin"],
    ["unlisted internal page", "/signin"],
    ["prefix lookalike", "/statusevil"],
    ["empty", ""],
    ["missing", null],
    ["oversized", `/status?${"a".repeat(600)}`],
  ])("rejects %s", (_name, value) => {
    expect(web(value as string | null)).toBe("/status");
    expect(con(value as string | null)).toBe("/");
  });

  it("does not let the MFA step bounce back to sign-in or to itself", () => {
    expect(con("/mfa")).toBe("/");
    expect(con("/signin?next=https://evil.example")).toBe("/");
  });
});
