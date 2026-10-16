"""Browser test of Phase 6: jury evaluation and volunteer assignment, in the console and the mobile app (web build).

Run on a FRESHLY SEEDED database (it checks a volunteer shortage, so earlier imports must not be present):
  createdb ... && DATABASE_URL=... pnpm db:seed && DATABASE_URL=... pnpm dev:api
  pnpm dev:console      and the mobile web build on :8081 (pnpm --filter @sj/mobile export:web; serve dist-web with SPA fallback)

setup (API): Admin imports 3 startups, 2 jury members and 2 volunteers for 2026 (synthetic, example.test); three of them activate
manager:  approves rubric v1 -> assigns the juror to two startups -> schedules a third and starts its pitch
          -> generates a random volunteer draft (shortage shown as unassigned targets) -> saves it (messages: in-app sent, email queued)
          -> reassigns one volunteer with a reason -> history shows who, when, why and the replacement
admin:    no Jury section (403 when opened directly); sees volunteers but cannot save or reassign
juror (app): sees only assigned startups and the current pitch -> cannot score the pitching startup -> saves a draft -> submits -> locked
volunteer (app): sees their own assignment with the target's contact (no email)
manager:  reviews the submitted evaluation (no winner) -> reopens it with a reason

Usage: python3 scripts/e2e_jury_volunteers.py [screenshot_dir]   (API :4000, console :3001, mobile web :8081)
"""
import json
import re
import sys
import time
import urllib.request
from playwright.sync_api import expect, sync_playwright

API, CONSOLE, APP = "http://localhost:4000", "http://localhost:3001", "http://localhost:8081"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
s = str(int(time.time()))[-6:]
JUROR, JUROR2 = f"juror{s}@example.test", f"juror2-{s}@example.test"
VOL1, VOL2 = f"vol{s}@example.test", f"vol2-{s}@example.test"
STARTUPS = [(f"Sal Leaf {s}", f"lead-a{s}@example.test"), (f"Millet Mill {s}", f"lead-b{s}@example.test"), (f"Bamboo Works {s}", f"lead-c{s}@example.test")]
SCORES = {"Innovation": 8, "Feasibility": 7, "Scalability": 6, "Market relevance": 9, "Impact": 10, "Pitch delivery": 5}


def api(method, path, token=None, body=None):
    req = urllib.request.Request(f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={**({"content-type": "application/json"} if body is not None else {}),
                                          **({"authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def token(email):
    return api("POST", "/v1/dev/session", body={"email": email})["token"]


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def import_csv(admin, category, csv):
    batch = api("POST", "/v1/admin/imports", admin, {"category": category, "edition": 2026, "fileName": f"{category}-{s}.csv", "csv": csv})
    api("POST", f"/v1/admin/imports/{batch['id']}/commit", admin, {})


def activate(admin, email):
    t = token(email)
    api("GET", "/v1/me", t)                                     # links the imported account to this sign-in
    user = api("GET", f"/v1/admin/users?q={email}", admin)["items"][0]
    code = api("POST", f"/v1/admin/users/{user['id']}/activation", admin)["token"]
    api("POST", "/v1/me/activation", t, {"token": code})


# ---- setup through the Phase 3 import API (synthetic people only)
admin = token("admin@dev.local")
import_csv(admin, "startups", "startup_name,position,full_name,email,mobile,city,state\n" + "".join(
    f"{n},leader,{n} Leader,{e},+9190000{s[-3:]}{i}{i},Gunupur,Odisha\n" for i, (n, e) in enumerate(STARTUPS)))
import_csv(admin, "jury", f"full_name,email,mobile\nDr Asha Patnaik,{JUROR},+9191000{s[-5:]}\nProf Ravi Das,{JUROR2},\n")
import_csv(admin, "volunteers", f"full_name,email,mobile\nPriya Hembram,{VOL1},+9192000{s[-5:]}\nArjun Majhi,{VOL2},\n")
for e in (JUROR, VOL1, STARTUPS[0][1]):
    activate(admin, e)
manager = token("manager@dev.local")
pool = api("GET", "/v1/manage/editions/2026/volunteers", manager)
if pool["draftRun"] or pool["active"] or len(pool["freeVolunteers"]) >= len(pool["unassignedTargets"]):
    sys.exit("Run this on a freshly seeded database: it needs fewer free volunteers than targets and no assignments yet.")


def console_sign_in(browser, email, landing=r"/(applications|users|imports)"):
    page = browser.new_page(viewport={"width": 1300, "height": 1000})
    page.goto(f"{CONSOLE}/signin")
    page.get_by_label("Work email").fill(email)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(re.compile(landing))
    return page


def app_sign_in(browser, email):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{APP}/")
    page.wait_for_url(re.compile(r"/signin"))
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(re.compile(r"/home"))
    return ctx, page


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Management: rubric, jury assignments, pitch schedule
    con = console_sign_in(browser, "manager@dev.local")
    con.get_by_role("link", name="Jury").click()
    con.wait_for_url(re.compile(r"/jury"))
    v1 = con.get_by_role("region", name="Rubric version 1")
    expect(v1).to_be_visible()
    expect(con.get_by_text("No rubric is approved yet")).to_be_visible()
    v1.get_by_role("button", name="Approve version 1").click()
    expect(con.get_by_role("status")).to_contain_text("Rubric version 1 approved")
    for name, _ in STARTUPS[:2]:
        juror = con.get_by_label("Jury member")
        juror.select_option(juror.locator("option", has_text="Dr Asha Patnaik").get_attribute("value"))
        con.get_by_label("Startup to assign").select_option(label=name)
        con.get_by_role("button", name="Assign", exact=True).click()
        expect(con.get_by_role("table", name="Jury assignments").get_by_role("row", name=re.compile(re.escape(name)))).to_be_visible()
    con.get_by_label("Startup to schedule").select_option(label=STARTUPS[2][0])
    con.get_by_label("Time (IST)").fill("2026-12-18T10:30")
    con.get_by_label("Venue").fill("Main auditorium")
    con.get_by_role("button", name="Add to schedule").click()
    sched = con.get_by_role("table", name="Pitch schedule")
    sched.get_by_role("row", name=re.compile(STARTUPS[2][0])).get_by_role("button", name="Start pitch").click()
    expect(con.get_by_text(f"Now pitching: {STARTUPS[2][0]}")).to_be_visible()
    shot(con, "j1-jury-console")

    # ---- Management: volunteer draft with a shortage, save, reassign
    con.get_by_role("link", name="Volunteers").click()
    con.wait_for_url(re.compile(r"/volunteers"))
    con.get_by_role("button", name="Generate random assignment").click()
    draft = con.get_by_role("region", name="Draft assignment")
    expect(draft.get_by_text("Not visible to participants")).to_be_visible()
    expect(draft.get_by_text(re.compile(r"Not enough volunteers: 3 target\(s\) will have no volunteer"))).to_be_visible()
    expect(draft.get_by_role("table", name="Draft pairs").locator("tbody tr")).to_have_count(2)
    shot(con, "v1-draft-shortage")
    draft.get_by_role("button", name="Save and notify").click()
    expect(con.get_by_role("status")).to_contain_text("Assignments saved")
    current = con.get_by_role("table", name="Current assignments")
    expect(current.locator("tbody tr")).to_have_count(2)
    expect(current.get_by_text(re.compile(r"in-app:\s*sent")).first).to_be_visible()
    expect(current.get_by_text(re.compile(r"email:\s*queued")).first).to_be_visible()     # no provider: never reported as sent
    expect(con.get_by_role("list", name="Unassigned targets").locator("li")).to_have_count(3)
    row = current.get_by_role("row", name=re.compile("Arjun Majhi"))
    row.get_by_role("button", name="Reassign").click()
    expect(row.get_by_role("button", name="Confirm reassignment")).to_be_disabled()
    row.get_by_label("New target").select_option(index=1)
    row.get_by_label("Reason (recorded)").fill("Arjun speaks the team's language")
    row.get_by_role("button", name="Confirm reassignment").click()
    expect(con.get_by_role("status")).to_contain_text("Reassigned")
    history = con.get_by_role("table", name="Assignment history")
    expect(history.get_by_role("row", name=re.compile("Arjun Majhi"))).to_contain_text("Arjun speaks the team's language")
    expect(history.get_by_role("row", name=re.compile("Arjun Majhi"))).to_contain_text("Dev Manager")
    expect(history.get_by_role("row", name=re.compile("Arjun Majhi"))).to_contain_text("Arjun Majhi →")
    shot(con, "v2-reassigned-history")

    # ---- Admin: no jury access; volunteers visible but no saving or reassigning (TBD-47)
    adm = console_sign_in(browser, "admin@dev.local")
    expect(adm.get_by_role("link", name="Jury")).to_have_count(0)
    adm.goto(f"{CONSOLE}/jury")
    expect(adm.locator(".notice-error")).to_contain_text("does not have Management permissions")
    adm.goto(f"{CONSOLE}/volunteers")
    expect(adm.get_by_role("table", name="Current assignments")).to_be_visible()
    expect(adm.get_by_role("button", name="Reassign")).to_have_count(0)
    adm.close()

    # ---- Juror in the app: own startups, the current pitch, draft, submit, locked
    ctx, app = app_sign_in(browser, JUROR)
    expect(app.get_by_text("Jury Member", exact=True)).to_be_visible()
    app.get_by_role("button", name="Jury: score your startups (2026)").click()
    app.wait_for_url(re.compile(r"/jury"))
    expect(app.get_by_text("Now pitching", exact=True)).to_be_visible()
    expect(app.get_by_role("button", name=f"Startup {STARTUPS[0][0]}")).to_be_visible()
    expect(app.get_by_role("button", name=f"Startup {STARTUPS[1][0]}")).to_be_visible()
    expect(app.get_by_role("button", name=f"Startup {STARTUPS[2][0]}")).to_have_count(0)   # not assigned
    shot(app, "m-j1-jury-list")
    app.get_by_role("button", name=f"Now pitching: {STARTUPS[2][0]}").click()
    expect(app.get_by_text("not assigned to you, so you cannot score it")).to_be_visible()
    expect(app.get_by_text(re.compile(r"@example\.test|\+919"))).to_have_count(0)            # no contact details
    app.go_back()
    app.get_by_role("button", name=f"Startup {STARTUPS[0][0]}").click()
    expect(app.get_by_role("heading", name=STARTUPS[0][0])).to_be_visible()
    expect(app.get_by_role("button", name="Submit scores")).to_be_disabled()
    app.get_by_role("radio", name="Innovation 8").click()
    app.get_by_label("Comments (optional)").fill("Clear field pilot with paying caterers.")
    app.get_by_role("button", name="Save draft").click()
    expect(app.get_by_text("Draft saved")).to_be_visible()
    for label, n in SCORES.items():
        app.get_by_role("radio", name=f"{label} {n}", exact=True).click()
    expect(app.get_by_text("Total if submitted: 72.22 / 100")).to_be_visible()
    app.get_by_role("button", name="Submit scores").click()
    expect(app.get_by_text("Scores submitted. They are now locked.")).to_be_visible()
    expect(app.get_by_text("Total: 72.22 / 100")).to_be_visible()
    expect(app.get_by_role("button", name="Submit scores")).to_have_count(0)
    expect(app.get_by_role("radio", name="Impact 1", exact=True)).to_be_disabled()
    shot(app, "m-j2-scores-locked")
    ctx.close()

    # ---- Volunteer in the app: own assignment with the target's contact, no email
    ctx, app = app_sign_in(browser, VOL1)
    app.get_by_role("button", name="My volunteer assignment").click()
    app.wait_for_url(re.compile(r"/volunteer"))
    expect(app.get_by_text("Your assignment")).to_be_visible()
    expect(app.get_by_text(re.compile(r"You are the volunteer for the (startup|jury member)"))).to_be_visible()
    expect(app.get_by_text(re.compile(r"@example\.test"))).to_have_count(0)
    shot(app, "m-v1-my-assignment")
    ctx.close()

    # ---- Management: review (no winner) and reopen with a reason
    con.get_by_role("link", name="Jury").click()
    con.wait_for_url(re.compile(r"/jury"))
    summary = con.get_by_role("table", name="Evaluation summary")
    expect(summary.get_by_role("row", name=re.compile(STARTUPS[0][0]))).to_contain_text("1 of 1")
    expect(summary.get_by_role("row", name=re.compile(STARTUPS[0][0]))).to_contain_text("v1: 72.22")
    expect(con.get_by_text(re.compile("winner", re.I))).to_have_count(1)                     # only the "never names a winner" note
    submitted = con.get_by_role("table", name="Submitted evaluations")
    submitted.get_by_role("button", name="Reopen").click()
    expect(submitted.get_by_role("button", name="Confirm reopen")).to_be_disabled()
    submitted.get_by_label("Reason for reopening").fill("Juror asked to correct the impact score.")
    submitted.get_by_role("button", name="Confirm reopen").click()
    expect(con.get_by_role("status").first).to_contain_text("Evaluation reopened")
    expect(con.get_by_role("table", name="Jury assignments").get_by_text("reopened")).to_be_visible()
    shot(con, "j2-review-reopened")
    browser.close()
print("E2E jury and volunteers (Phase 6) passed, run", s)
