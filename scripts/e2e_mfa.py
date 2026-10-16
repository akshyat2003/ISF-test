"""Browser test of the staff MFA policy (run the API with REQUIRE_STAFF_MFA=true, as production requires).

Management and Admin sign in, see no privileged sections until they complete the second factor, are routed to the
MFA step, and get their sections only after verifying. Participants (website) are not asked for MFA.

Usage: python3 scripts/e2e_mfa.py [screenshot_dir]   (API with REQUIRE_STAFF_MFA=true on :4000, web :3000, console :3001)
"""
import re
import sys
import time
from playwright.sync_api import expect, sync_playwright

WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))

with sync_playwright() as p:
    browser = p.chromium.launch()
    for email, landing, section in [("manager@dev.local", r"/applications", "Applications"), ("admin@dev.local", r"/users", "Accounts")]:
        page = browser.new_page(viewport={"width": 1200, "height": 900})
        page.goto(f"{CONSOLE}/signin")
        page.get_by_label("Work email").fill(email)
        page.get_by_role("button", name="Continue").click()
        page.wait_for_url(re.compile(r"/mfa"))                                     # routed to the second factor
        expect(page.get_by_role("heading", name="Verify it’s you")).to_be_visible()
        expect(page.get_by_role("link", name=section)).to_have_count(0)            # no privileged sections yet
        page.screenshot(path=f"{OUT}/mfa-1-{email.split('@')[0]}-step-up.png", full_page=True)
        # Direct navigation does not bypass it: the API withholds the permission.
        page.goto(f"{CONSOLE}{landing}")
        expect(page.get_by_text("Multi-factor verification is required for your role.")).to_be_visible()
        page.get_by_role("link", name="Verify now").click()
        page.get_by_label("6-digit code").fill("12345")
        expect(page.get_by_role("button", name="Verify")).to_be_disabled()
        page.get_by_label("6-digit code").fill("123456")
        page.get_by_role("button", name="Verify").click()
        page.wait_for_url(re.compile(landing))
        expect(page.get_by_role("link", name=section)).to_be_visible()
        expect(page.get_by_role("heading", name=section)).to_be_visible()
        expect(page.get_by_text("Multi-factor verification is required")).to_have_count(0)
        page.screenshot(path=f"{OUT}/mfa-2-{email.split('@')[0]}-verified.png", full_page=True)
        page.close()

    # Participants are never asked for MFA.
    web = browser.new_page()
    web.goto(f"{WEB}/signin?next=/status")
    web.get_by_label("Email", exact=True).fill(f"participant{stamp}@demo.in")
    web.get_by_role("button", name="Continue").click()
    web.wait_for_url(f"{WEB}/status")
    expect(web.get_by_text(re.compile("No application is linked"))).to_be_visible()
    browser.close()
print("E2E MFA policy passed")
