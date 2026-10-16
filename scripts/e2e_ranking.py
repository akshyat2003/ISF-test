"""Browser test of Phase 5: AI ranking, overrides, release, two-person correction, results and withdrawal.

Runs AFTER the 2026 registration deadline, so start the API with a pinned development clock and the synthetic cohort:
  SEED_DEMO_APPLICATIONS=1 pnpm db:seed
  DEV_NOW=2026-11-06T10:00:00+05:30 pnpm dev:api        (RANKING_PROVIDER=stub: development stub, not an AI)
  pnpm dev:web  and  pnpm dev:console

manager:  approve criteria v1 -> rank all 2026 applications -> run shows ranks and manual-review flags
          -> selection limit 2 -> selecting a lower-ranked application needs a reason (TBD-18) -> release
          -> requests a correction of a released decision
manager2: sees the pending correction and approves it (two people, TBD-37)
website:  the applicant sees the corrected result and the correction message; another applicant withdraws

Usage: python3 scripts/e2e_ranking.py [screenshot_dir]   (API on :4000 with DEV_NOW, web :3000, console :3001)
"""
import re
import sys
from playwright.sync_api import expect, sync_playwright

WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def console_sign_in(browser, email, landing=r"/applications"):
    page = browser.new_page(viewport={"width": 1300, "height": 1000})
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{CONSOLE}/signin")
    page.get_by_label("Work email").fill(email)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(re.compile(landing))
    return page


with sync_playwright() as p:
    browser = p.chromium.launch()
    con = console_sign_in(browser, "manager@dev.local")

    # ---- criteria (TBD-01) and a ranking run
    con.get_by_role("link", name="AI ranking").click()
    con.wait_for_url(re.compile(r"/ranking"))
    v1 = con.get_by_role("region", name="Criteria version 1")
    expect(v1).to_be_visible()
    if v1.get_by_role("button", name="Approve version 1").count():
        v1.get_by_role("button", name="Approve version 1").click()
    expect(v1.get_by_text("Approved", exact=True)).to_be_visible()
    con.get_by_role("combobox", name=re.compile("Criteria version")).select_option(label="Version 1")
    con.get_by_role("button", name="Rank all 2026 applications").click()
    runs_table = con.locator("table").last
    expect(runs_table.locator("tbody tr").first.get_by_text("completed")).to_be_visible(timeout=60_000)
    shot(con, "r1-ranking-runs")
    runs_table.locator("tbody tr").first.get_by_role("link", name="Open").click()
    expect(con.get_by_role("heading", name=re.compile("Ranked"))).to_be_visible()
    expect(con.get_by_text("Text tries to steer the AI").first).to_be_visible()          # AT-40: scored, flagged
    expect(con.get_by_text("Missing answers: review manually").first).to_be_visible()   # FR-RNK-13: not ranked
    shot(con, "r2-run-detail")
    # The lowest-ranked application that is still undecided: selecting it is an override once the limit is 2.
    undecided = con.locator("table tbody tr").filter(has=con.locator("span.status", has_text=re.compile(r"^ranked$")))
    fourth_name = undecided.last.get_by_role("link").first.inner_text()

    # ---- selection limit as the cut line; an override needs a reason (TBD-18)
    con.goto(f"{CONSOLE}/applications?edition=2026")
    con.get_by_label(re.compile("Selection limit")).fill("2")
    con.get_by_role("button", name="Save").click()
    expect(con.locator(".notice-ok")).to_contain_text("Selection limit saved")
    con.get_by_role("link", name=fourth_name, exact=True).first.click()
    expect(con.get_by_role("heading", name=re.compile("AI ranking"))).to_be_visible()
    expect(con.get_by_text("required for an override")).to_be_visible()
    con.get_by_role("button", name="Draft: select").click()
    expect(con.locator("p.field-error")).to_contain_text("needs a written reason")
    con.get_by_label(re.compile("Reason")).fill("Strong partnerships with district federations, not visible in the written answers.")
    con.get_by_role("button", name="Draft: select").click()
    expect(con.get_by_text(re.compile(r"Override of the AI ranking \(rank \d+\)"))).to_be_visible()
    shot(con, "r3-override-with-reason")

    # ---- release (accepting the over-limit confirmation if the dev database already has selections)
    con.goto(f"{CONSOLE}/applications?edition=2026")
    con.get_by_role("button", name="Release decisions").click()
    expect(con.locator(".notice-ok")).to_contain_text(re.compile(r"Released \d+ \(\d+ selected"))
    shot(con, "r4-released")

    # ---- correction: manager asks, manager2 approves (TBD-37)
    con.get_by_role("link", name=fourth_name, exact=True).first.click()
    con.get_by_label(re.compile("Reason for changing it")).fill("Eligibility check after release: the team is already part of the event.")
    con.get_by_role("button", name="Request correction").click()
    expect(con.get_by_text("A different Management member must approve it.")).to_be_visible()
    shot(con, "r5-correction-requested")
    con2 = console_sign_in(browser, "manager2@dev.local")
    expect(con2.get_by_text(re.compile("waiting for a second approver"))).to_be_visible()
    con2.get_by_role("link", name=fourth_name, exact=True).first.click()
    con2.get_by_label("Note (optional)").fill("Confirmed with the organisers.")
    con2.get_by_role("button", name="Approve correction").click()
    expect(con2.get_by_text(re.compile(r"Released: not selected"))).to_be_visible()
    expect(con2.get_by_text(re.compile(r"corrected"))).to_be_visible()
    shot(con2, "r6-correction-approved")

    # ---- the applicant (a synthetic demo account if the run ranked one fourth) sees the corrected result
    demo = {"Demo Cold Store": "demo1", "Demo Millet Mill": "demo2", "Demo Craft Market": "demo3", "Demo Repair Hub": "demo4",
            "Demo Steering Test": "demo5"}
    if fourth_name in demo:
        web = browser.new_page(viewport={"width": 1100, "height": 900})
        web.goto(f"{WEB}/signin?next=/status")
        web.get_by_label("Email", exact=True).fill(f"{demo[fourth_name]}@example.test")
        web.get_by_role("button", name="Continue").click()
        web.wait_for_url(f"{WEB}/status")
        expect(web.get_by_text("Not selected", exact=True)).to_be_visible()
        expect(web.get_by_text(re.compile("correct an earlier message"))).to_be_visible()
        shot(web, "r7-applicant-corrected")

    # ---- an applicant withdraws before the event (TBD-37)
    web2 = browser.new_page(viewport={"width": 1100, "height": 900})
    web2.goto(f"{WEB}/signin?next=/status")
    web2.get_by_label("Email", exact=True).fill("demo6@example.test")
    web2.get_by_role("button", name="Continue").click()
    web2.wait_for_url(f"{WEB}/status")
    expect(web2.get_by_text("Startup Jathara 2026")).to_be_visible()
    if web2.get_by_role("button", name="Withdraw 2026 application").count():
        web2.get_by_role("button", name="Withdraw 2026 application").click()
        web2.get_by_role("button", name="Confirm: withdraw 2026").click()
    expect(web2.get_by_text("Withdrawn", exact=True)).to_be_visible()
    shot(web2, "r8-withdrawn")

    browser.close()
print("E2E ranking (Phase 5) passed; corrected:", fourth_name)
