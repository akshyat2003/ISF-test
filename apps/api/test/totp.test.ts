import { describe, expect, it } from "vitest";
import { totp } from "../scripts/totp.js";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890" (base32 below), 8 digits.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
describe("TOTP (RFC 6238 test vectors)", () => {
  it.each([[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]])(
    "T=%i → %s", (t, code) => { expect(totp(SECRET, t * 1000, 8)).toBe(code); });
  it("6-digit codes are the low digits", () => { expect(totp(SECRET, 59_000)).toBe("287082"); });
});
