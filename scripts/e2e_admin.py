"""Browser end-to-end test of Phase 3 through the real screens.

console (Admin): import a startups CSV -> preview shows row errors -> commit -> account awaits activation
console (Admin): issue a single-use activation code
website (participant): sign in -> blocked until activated -> enter code -> active with role and 2026 access
console (Admin): the code cannot be reused; Management cannot open Accounts or Imports

Usage: python3 scripts/e2e_admin.py [screenshot_dir]   (API on :4000, web on :3000, console on :3001)
"""
import os
import re
import sys
import tempfile
import time
from playwright.sync_api import expect, sync_playwright

WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))
leader = f"leader{stamp}@predefined.in"
startup = f"Kandhamal Turmeric Co {stamp[-5:]}"
csv_text = "\n".join([
    "startup_name,position,full_name,email,mobile,city,state",
    f"{startup},leader,Sunita Kanhar,{leader},98{stamp[-8:]},Phulbani,Odisha",
    f"{startup},member,Rabi Kanhar,member{stamp}@predefined.in,,,",
    f"Broken {stamp},leader,,not-an-email,12,,",
]) + "\n"


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def console_sign_in(page, email):
    page.goto(f"{CONSOLE}/signin")
    page.get_by_label("Work email").fill(email)
    page.get_by_role("button", name="Continue").click()


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Admin imports predefined startups
    adm = browser.new_page(viewport={"width": 1300, "height": 900})
    console_sign_in(adm, "admin@dev.local")
    adm.wait_for_url(re.compile(r"/users"))
    adm.get_by_role("link", name="Imports").click()
    path = os.path.join(tempfile.mkdtemp(), f"startups-{stamp}.csv")
    with open(path, "w", encoding="utf-8") as f:
        f.write(csv_text)
    adm.get_by_label("CSV file").set_input_files(path)
    adm.get_by_role("button", name="Check file").click()
    adm.wait_for_url(re.compile(r"/imports/[0-9a-f-]{36}"))
    expect(adm.get_by_text("2 valid")).to_be_visible()
    expect(adm.get_by_text("full_name: Required")).to_be_visible()
    expect(adm.get_by_text("email: Not a valid email address")).to_be_visible()
    shot(adm, "p3-1-import-preview")
    adm.once("dialog", lambda d: d.accept())
    adm.get_by_role("button", name="Commit 2 rows").click()
    expect(adm.get_by_text("2 created")).to_be_visible()
    shot(adm, "p3-2-import-committed")

    # ---- Admin issues an activation code
    adm.get_by_role("link", name="Accounts").click()
    adm.get_by_placeholder("Name, email or mobile").fill(leader)
    adm.get_by_role("button", name="Search").click()
    adm.wait_for_url(re.compile(r"/users\?q="))
    expect(adm.locator("tbody tr")).to_have_count(1)                         # filtered result, not the previous page
    row = adm.locator("tr", has_text=leader)
    expect(row.get_by_text("pending activation")).to_be_visible()
    expect(row.get_by_text("startup team leader (2026)")).to_be_visible()
    row.get_by_role("link", name="Sunita Kanhar").click()
    adm.get_by_role("button", name="Issue activation code").click()
    code = adm.locator(".notice-ok code").inner_text().strip()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", code), code
    shot(adm, "p3-3-activation-issued")

    # ---- participant activates on the website
    web = browser.new_page(viewport={"width": 1100, "height": 900})
    web.goto(f"{WEB}/status")
    web.get_by_role("link", name="Sign in").first.click()
    web.get_by_label("Email", exact=True).fill(leader)
    web.get_by_role("button", name="Continue").click()
    expect(web.get_by_text("Your account is waiting for activation.")).to_be_visible()   # locked until activated
    web.get_by_role("link", name="Activate your account").click()
    web.get_by_label("Activation code").fill("x" * 43)
    web.get_by_role("button", name="Activate").click()
    expect(web.get_by_text(re.compile("invalid, expired, already used"))).to_be_visible()
    web.get_by_label("Activation code").fill(code)
    web.get_by_role("button", name="Activate").click()
    expect(web.get_by_text("Your account is active.")).to_be_visible()
    expect(web.get_by_text(re.compile(r"startup team leader · event access: 2026"))).to_be_visible()
    shot(web, "p3-4-activated")

    # ---- Admin sees the account active; the code is spent
    adm.reload()
    expect(adm.get_by_text("active", exact=True)).to_be_visible()
    expect(adm.get_by_role("button", name="Issue activation code")).to_have_count(0)

    # ---- Management cannot use Admin sections
    mgr = browser.new_page()
    console_sign_in(mgr, "manager@dev.local")
    mgr.wait_for_url(re.compile(r"/applications"))
    expect(mgr.get_by_role("link", name="Imports")).to_have_count(0)
    mgr.goto(f"{CONSOLE}/imports")
    expect(mgr.get_by_text("Your account does not have Admin permissions.")).to_be_visible()

    browser.close()
print("E2E admin (Phase 3) passed for", startup)
