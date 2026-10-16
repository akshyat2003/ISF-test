"""End-to-end test of the Phase 4 mobile app, run as its web build in a phone-sized browser against the real API.

applicant: sign in -> register for both years (field validation) -> per-year status -> sign out
imported volunteer: (Admin imports + issues code via the API) -> sign in -> forced to activate -> wrong code refused
                    -> right code -> role-aware home with 2026 event card
staff: told to use the web console

Usage: python3 scripts/e2e_mobile.py [screenshot_dir]   (API on :4000, mobile web build served on :8081)
"""
import json
import re
import sys
import time
import urllib.request
from playwright.sync_api import expect, sync_playwright

# Answers to the configured application form (migration 0007, TBD-39); matched by the start of each question.
FORM_ANSWERS = [
    ("What problem are you solving", "Forest-dwelling women's collectives lack a steady market for their produce."),
    ("What is your solution", "Branded sal-leaf tableware sold directly to caterers in Bhubaneswar and Vizag."),
    ("What stage is the startup at", "Pilot: 12 collectives, 4 caterers buying monthly since August."),
    ("Who are your customers", "Caterers and hotels in eastern India that must replace single-use plastic."),
    ("What economic, social or environmental impact", "Regular income for 300 women and less plastic waste."),
    ("Who is in the founding team", "A product designer and a supply-chain manager with rural retail experience."),
]


def fill_form_answers(page):
    for start, text in FORM_ANSWERS:
        page.get_by_label(re.compile("^" + re.escape(start))).fill(text)


API, APP = "http://localhost:4000", "http://localhost:8081"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))
applicant, volunteer = f"app{stamp}@mobile.in", f"vol{stamp}@mobile.in"
startup = f"Millet Mill {stamp[-5:]}"


def api(method, path, token=None, body=None):
    req = urllib.request.Request(f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={**({"content-type": "application/json"} if body is not None else {}),
                                          **({"authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def sign_in(page, email):
    page.goto(f"{APP}/")
    page.wait_for_url(re.compile(r"/signin"))
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_role("button", name="Continue").click()


# ---- Admin prepares an imported volunteer with an activation code (Phase 3 API)
admin = api("POST", "/v1/dev/session", body={"email": "admin@dev.local"})["token"]
batch = api("POST", "/v1/admin/imports", admin, {"category": "volunteers", "edition": 2026, "fileName": f"vol-{stamp}.csv",
                                                 "csv": f"full_name,email\nPriya Hembram,{volunteer}\n"})
api("POST", f"/v1/admin/imports/{batch['id']}/commit", admin, {})
user = api("GET", f"/v1/admin/users?q={volunteer}", admin)["items"][0]
code = api("POST", f"/v1/admin/users/{user['id']}/activation", admin)["token"]

with sync_playwright() as p:
    browser = p.chromium.launch()
    phone = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)

    # ---- new applicant registers from the app
    ctx = browser.new_context(**phone)
    page = ctx.new_page()
    sign_in(page, applicant)
    page.wait_for_url(re.compile(r"/home"))
    expect(page.get_by_text("Welcome")).to_be_visible()
    shot(page, "m1-home-applicant")
    page.get_by_role("button", name="Register a startup").click()
    page.get_by_role("button", name="Submit application").click()
    expect(page.get_by_text("Choose which year(s) to apply for")).to_be_visible()
    page.get_by_role("radio", name="Both 2026 and 2027 (two separate applications)").click()
    page.get_by_label("Startup name *").fill(startup)
    page.get_by_label("What does your startup do? *").fill("Too short")
    page.get_by_label("Full name *").fill("Laxmi Gond")
    page.get_by_label("Mobile number *").fill("98765 43210")
    fill_form_answers(page)
    page.get_by_role("checkbox", name="I have read the privacy notice").click()
    page.get_by_role("checkbox", name="I confirm that I am 18 years of age or older").click()
    page.get_by_role("button", name="Submit application").click()
    expect(page.get_by_text(re.compile(r"at least 20|>=20|too small", re.I)).first).to_be_visible()   # server-side field error
    page.get_by_label("What does your startup do? *").fill("Stone-ground millet flour from tribal farmer collectives in Rayagada.")
    shot(page, "m2-register-form")
    page.get_by_role("button", name="Submit application").click()
    expect(page.get_by_text(f"Application submitted for {startup}.")).to_be_visible()
    page.get_by_role("button", name="View application status").click()
    expect(page.get_by_text("Startup Jathara 2026")).to_be_visible()
    expect(page.get_by_text("Startup Jathara 2027")).to_be_visible()
    expect(page.get_by_text("Under review")).to_have_count(2)
    shot(page, "m3-status")
    # TBD-37: withdraw the 2027 application in the app; 2026 stays under review.
    page.get_by_role("button", name="Withdraw 2027 application").click()
    page.get_by_role("button", name="Confirm: withdraw 2027").click()
    expect(page.get_by_text("Withdrawn", exact=True)).to_be_visible()
    expect(page.get_by_text("Under review")).to_have_count(1)
    shot(page, "m3b-status-withdrawn")
    page.go_back()
    page.wait_for_url(re.compile(r"/home"))
    expect(page.get_by_text(f"{startup} · 2026")).to_be_visible()
    page.get_by_role("button", name="Sign out").click()
    page.wait_for_url(re.compile(r"/signin"))
    ctx.close()

    # ---- imported volunteer must activate first
    ctx = browser.new_context(**phone)
    page = ctx.new_page()
    sign_in(page, volunteer)
    page.wait_for_url(re.compile(r"/activate"))
    expect(page.get_by_text(f"Signed in as {volunteer}", exact=False)).to_be_visible()
    page.get_by_label("Activation code").fill("y" * 43)
    page.get_by_role("button", name="Activate").click()
    expect(page.get_by_text(re.compile("invalid, expired, already used"))).to_be_visible()
    shot(page, "m4-activate-refused")
    page.get_by_label("Activation code").fill(code)
    page.get_by_role("button", name="Activate").click()
    page.wait_for_url(re.compile(r"/home"))
    expect(page.get_by_text("Hello, Priya")).to_be_visible()
    expect(page.get_by_text("Volunteer", exact=True)).to_be_visible()
    expect(page.get_by_text("Startup Jathara 2026")).to_be_visible()
    expect(page.get_by_text(re.compile("18–20 December 2026"))).to_be_visible()
    expect(page.get_by_role("button", name="Register a startup")).to_have_count(0)   # participants are not applicants
    shot(page, "m5-home-volunteer")
    ctx.close()

    # ---- sign in with a mobile number instead of an email
    ctx = browser.new_context(**phone)
    page = ctx.new_page()
    page.goto(f"{APP}/")
    page.wait_for_url(re.compile(r"/signin"))
    page.get_by_role("radio", name="Sign in with mobile number").click()
    expect(page.get_by_role("button", name="Continue")).to_be_disabled()
    page.get_by_label("Mobile number", exact=True).fill(f"8{stamp[-9:]}")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(re.compile(r"/home"))
    expect(page.get_by_role("button", name="Register a startup")).to_be_visible()
    shot(page, "m6-home-phone-sign-in")
    ctx.close()

    # ---- staff are pointed to the web console
    ctx = browser.new_context(**phone)
    page = ctx.new_page()
    sign_in(page, "manager@dev.local")
    page.wait_for_url(re.compile(r"/home"))
    expect(page.get_by_text(re.compile("done in the web console"))).to_be_visible()
    ctx.close()
    browser.close()
print("E2E mobile (Phase 4) passed for", startup, "and", volunteer)
