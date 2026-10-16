"""Browser smoke test of the M1 vertical slice through the real screens.

website: sign in -> register for both years -> status
console: management sign-in -> sees the application; decisions refused while registration is open (TBD-42)
website: withdraw the 2027 application (TBD-37); 2026 stays under review
console: Admin without a management grant is refused

Usage: python3 scripts/e2e_smoke.py [screenshot_dir]   (API on :4000, web on :3000, console on :3001)
"""
import re
import sys
import time
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


WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))
email = f"leader{stamp}@demo.in"
startup = f"Sal Leaf Studio {stamp[-5:]}"


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- applicant registers for both years
    web = browser.new_page(viewport={"width": 1200, "height": 900})
    web.goto(f"{WEB}/")
    expect(web.get_by_role("heading", name="Startup Jathara @ Dandakaranya")).to_be_visible()
    expect(web.get_by_text("18–20 December 2026")).to_be_visible()
    shot(web, "1-home")
    web.get_by_role("link", name="Register your startup").first.click()
    web.get_by_role("link", name="Sign in to continue").click()
    web.get_by_label("Email", exact=True).fill(email)
    web.get_by_role("button", name="Continue").click()
    web.wait_for_url(f"{WEB}/register")

    web.get_by_role("button", name="Submit application").click()            # empty submit shows a field error
    expect(web.get_by_text("Choose which year(s) to apply for")).to_be_visible()
    web.get_by_label("Both 2026 and 2027 (two separate applications)").check()
    web.get_by_label("Startup name *").fill(startup)
    web.get_by_label(re.compile("What does your startup do")).fill("Sal-leaf plates and packaging made with forest-dwelling women's collectives.")
    web.get_by_label("City").fill("Gunupur")
    web.get_by_label("State").fill("Odisha")
    web.get_by_label("Full name *").fill("Mitali Sabar")
    web.get_by_label(re.compile("Mobile number")).fill("98765 01234")
    fill_form_answers(web)
    web.get_by_label(re.compile("I have read the")).check()
    web.get_by_label(re.compile("18 years of age or older")).check()
    shot(web, "2-register-form")
    web.get_by_role("button", name="Submit application").click()
    expect(web.get_by_text(f"Application submitted for {startup}.")).to_be_visible()
    shot(web, "3-register-done")
    web.get_by_role("link", name="View application status").click()
    expect(web.get_by_text("Under review")).to_have_count(2)

    # ---- management drafts and releases a decision
    con = browser.new_page(viewport={"width": 1300, "height": 900})
    con.goto(f"{CONSOLE}/signin")
    con.get_by_label("Work email").fill("manager@dev.local")
    con.get_by_role("button", name="Continue").click()
    con.wait_for_url(re.compile(r"/applications"))
    row = con.locator("tr", has_text=startup)
    expect(row).to_be_visible()
    # TBD-42: decisions open only after registration closes, so the whole cohort is reviewed together.
    row.get_by_role("button", name="Select", exact=True).click()
    expect(con.locator(".notice-error")).to_contain_text("only after registration closes")
    web.reload()
    expect(web.get_by_text("Under review")).to_have_count(2)
    shot(con, "4-console-registration-open")
    # Decisions, release and results are covered after the deadline by scripts/e2e_ranking.py (API with DEV_NOW).

    # ---- the applicant withdraws the 2027 application; 2026 is untouched (TBD-37)
    web.get_by_role("button", name="Withdraw 2027 application").click()
    web.get_by_role("button", name="Confirm: withdraw 2027").click()
    expect(web.get_by_text("Withdrawn", exact=True)).to_be_visible()
    expect(web.get_by_text("Under review")).to_have_count(1)
    shot(web, "5-status-withdrawn-2027")

    # ---- admin without a management grant is refused
    adm = browser.new_page()
    adm.goto(f"{CONSOLE}/signin")
    adm.get_by_label("Work email").fill("admin@dev.local")
    adm.get_by_role("button", name="Continue").click()
    adm.wait_for_url(re.compile(r"/users"))                                   # admin lands on Accounts, not Applications
    expect(adm.get_by_role("link", name="Applications")).to_have_count(0)
    adm.goto(f"{CONSOLE}/applications")
    expect(adm.get_by_text("Your account does not have Management permissions.")).to_be_visible()

    browser.close()
print("E2E smoke passed for", startup)
