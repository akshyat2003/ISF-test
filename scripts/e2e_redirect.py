"""Browser test: crafted sign-in / MFA links cannot redirect a signed-in user off-site (open-redirect fix).

Usage: python3 scripts/e2e_redirect.py   (API :4000, web :3000, console :3001)
"""
import time
from urllib.parse import quote
from playwright.sync_api import sync_playwright

WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
EVIL = ["https://evil.example/phish", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/%2F%2Fevil.example"]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for i, target in enumerate(EVIL):
        page = browser.new_page()
        page.goto(f"{WEB}/signin?next={quote(target, safe='')}")
        page.get_by_label("Email", exact=True).fill(f"redirect{int(time.time())}{i}@demo.in")
        page.get_by_role("button", name="Continue").click()
        page.wait_for_url(f"{WEB}/status")
        assert page.url == f"{WEB}/status", page.url
        page.close()
    for target in EVIL:
        page = browser.new_page()
        page.goto(f"{CONSOLE}/signin?next={quote(target, safe='')}")
        page.get_by_label("Work email").fill("manager@dev.local")
        page.get_by_role("button", name="Continue").click()
        page.wait_for_url(lambda u: u.startswith(CONSOLE) and "/signin" not in u)
        assert page.url.startswith(CONSOLE), page.url
        page.goto(f"{CONSOLE}/mfa?next={quote(target, safe='')}")
        page.get_by_label("6-digit code").fill("123456")
        page.get_by_role("button", name="Verify").click()                # verification triggers location.assign(next)
        page.wait_for_url(lambda u: u.startswith(CONSOLE) and "/mfa" not in u)
        assert page.url.startswith(CONSOLE), page.url
        page.goto(f"{CONSOLE}/mfa?next={quote(target, safe='')}")       # already aal2: router.replace(next)
        page.wait_for_url(lambda u: u.startswith(CONSOLE) and "/mfa" not in u)
        assert page.url.startswith(CONSOLE), page.url
        page.close()
    # An approved internal destination still works.
    page = browser.new_page()
    page.goto(f"{WEB}/signin?next=%2Fregister")
    page.get_by_label("Email", exact=True).fill(f"redirectok{int(time.time())}@demo.in")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(f"{WEB}/register")
    browser.close()
print("E2E redirect protection passed")
