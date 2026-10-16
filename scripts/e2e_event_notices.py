"""Browser test of Phase 7: event information, documents and notices, across the console, the website and the app.

Run on a FRESHLY SEEDED database (it publishes the seeded tentative programme):
  DATABASE_URL=... pnpm db:seed && pnpm dev:api && pnpm dev:web && pnpm dev:console
  and the mobile web build on :8081 (pnpm --filter @sj/mobile export:web; serve dist-web with SPA fallback)

setup (API): Admin imports a juror and a volunteer for 2026 (synthetic, example.test); both activate
manager:   Event info: edits the seeded "Startup pitches" (time, venue), saves a draft (website unchanged), publishes
           with a change summary; publishes the pre-event session; cannot edit emergency contacts (Admin's, TBD-24)
website:   the programme shows the published items under the official day labels, 17 Dec as the pre-event day, "last updated"
admin:     cannot edit the schedule; uploads a jury-only PDF; publishes an emergency contact
app:       the juror sees the programme, 112 first, and the jury-only document; the volunteer does not see the document
manager:   moves the pitches to 14:00 and publishes: the website shows it without any release (AT-24);
           Notices: a jury-only notice, recipients checked, published; the juror has it in Messages, the volunteer does not;
           corrected (the juror sees the corrected text), then withdrawn (gone from the juror's inbox) (AT-25)

Usage: python3 scripts/e2e_event_notices.py [screenshot_dir]   (API :4000, website :3000, console :3001, mobile web :8081)
"""
import base64
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import expect, sync_playwright

API, WEB, CONSOLE, APP = "http://localhost:4000", "http://localhost:3000", "http://localhost:3001", "http://localhost:8081"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
s = str(int(time.time()))[-6:]
JUROR, VOL = f"juror{s}@example.test", f"vol{s}@example.test"


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
    api("GET", "/v1/me", t)
    user = api("GET", f"/v1/admin/users?q={email}", admin)["items"][0]
    code = api("POST", f"/v1/admin/users/{user['id']}/activation", admin)["token"]
    api("POST", "/v1/me/activation", t, {"token": code})


admin = token("admin@dev.local")
import_csv(admin, "jury", f"full_name,email\nDr Meera Behera,{JUROR}\n")
import_csv(admin, "volunteers", f"full_name,email\nSunil Gomango,{VOL}\n")
for e in (JUROR, VOL):
    activate(admin, e)
seeded = api("GET", "/v1/manage/editions/2026/content", token("manager@dev.local"))["items"]
if not any(i["state"] == "draft" and (i["draft"] or {}).get("title") == "Startup pitches" for i in seeded):
    sys.exit("Run this on a freshly seeded database: the seeded 'Startup pitches' draft must still be unpublished.")

pdf_path = os.path.join(tempfile.mkdtemp(), "jury-handbook.pdf")
with open(pdf_path, "wb") as f:
    f.write(b"%PDF-1.4\n% synthetic test document for the jury\n%%EOF\n")


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


def edit_pitches(con, start, end, venue, summary):
    card = con.get_by_role("region", name="Startup pitches")
    card.get_by_role("button", name="Edit").click()
    form = con.get_by_role("region", name="Edit item")
    form.get_by_label("Start (HH:MM, IST)").fill(start)
    form.get_by_label("End (HH:MM, IST)").fill(end)
    form.get_by_label("Venue").fill(venue)
    form.get_by_role("button", name="Save draft").click()
    expect(con.get_by_role("status")).to_contain_text("Saved as a draft")
    card.get_by_role("button", name="Publish").click()
    card.get_by_label("What changed").fill(summary)
    card.get_by_role("button", name="Confirm publish").click()
    expect(con.get_by_role("status")).to_contain_text("Published")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Management edits and publishes operational information (TBD-24)
    con = console_sign_in(browser, "manager@dev.local")
    con.get_by_role("link", name="Event info").click()
    con.wait_for_url(re.compile(r"/content"))
    expect(con.get_by_role("region", name="Startup pitches").get_by_text("Draft, never published")).to_be_visible()
    card = con.get_by_role("region", name="Startup pitches")
    card.get_by_role("button", name="Edit").click()
    form = con.get_by_role("region", name="Edit item")
    form.get_by_label("Start (HH:MM, IST)").fill("11:00")
    form.get_by_label("End (HH:MM, IST)").fill("13:00")
    form.get_by_label("Venue").fill(f"Main auditorium {s}")
    form.get_by_role("button", name="Save draft").click()
    expect(con.get_by_role("status")).to_contain_text("Saved as a draft")
    web = browser.new_page(viewport={"width": 1100, "height": 900})
    web.goto(f"{WEB}/event")
    expect(web.get_by_text(f"Main auditorium {s}")).to_have_count(0)            # a draft is not visible
    card.get_by_role("button", name="Publish").click()
    card.get_by_label("What changed").fill("Pitch time and venue confirmed")
    card.get_by_role("button", name="Confirm publish").click()
    expect(con.get_by_role("status")).to_contain_text("Published")
    expect(card.get_by_text("Published v1")).to_be_visible()
    pre = con.get_by_role("region", name="Pre-event domain-wise startup activities")
    pre.get_by_role("button", name="Publish").click()
    pre.get_by_label("What changed").fill("Pre-event session confirmed")
    pre.get_by_role("button", name="Confirm publish").click()
    expect(pre.get_by_text("Published v1")).to_be_visible()
    con.goto(f"{CONSOLE}/content?edition=2026&tab=emergency_contact")
    expect(con.get_by_text("maintained by the Admin")).to_be_visible()
    expect(con.get_by_role("button", name=re.compile("Add emergency"))).to_have_count(0)
    shot(con, "e1-console-event-info")

    # ---- website shows the published programme with official day labels (AT-37)
    web.goto(f"{WEB}/event")
    expect(web.get_by_role("heading", name="Thursday, 17 December 2026 · Pre-event day")).to_be_visible()
    expect(web.get_by_text("Pre-event domain-wise startup activities")).to_be_visible()
    friday = web.get_by_role("region", name="Friday, 18 December 2026")
    expect(friday.get_by_text("Startup pitches")).to_be_visible()
    expect(friday.get_by_text("11:00–13:00")).to_be_visible()
    expect(friday.get_by_text(f"Main auditorium {s}")).to_be_visible()
    expect(web.get_by_text(re.compile(r"Last updated .* IST"))).to_be_visible()
    expect(web.get_by_text("Registration and breakfast")).to_have_count(0)        # still a draft
    expect(web.get_by_role("link", name="112")).to_be_visible()
    shot(web, "e2-website-programme")

    # ---- Admin: source information only; jury-only document; emergency contact
    adm = console_sign_in(browser, "admin@dev.local")
    adm.goto(f"{CONSOLE}/content?edition=2026&tab=schedule_item")
    expect(adm.get_by_text("maintained by Management")).to_be_visible()
    expect(adm.get_by_role("region", name="Startup pitches").get_by_role("button", name="Edit")).to_have_count(0)
    adm.goto(f"{CONSOLE}/content?edition=2026&tab=documents")
    adm.get_by_role("button", name="Upload a document").click()
    up = adm.get_by_role("region", name="Upload document")
    up.get_by_label("Title").fill(f"Jury handbook {s}")
    up.get_by_label(re.compile("^File")).set_input_files(pdf_path)
    up.get_by_label("All participants").uncheck()
    up.get_by_label("Jury members").check()
    up.get_by_role("button", name="Upload").click()
    expect(adm.get_by_role("status")).to_contain_text("Document uploaded")
    expect(adm.get_by_role("table", name="Documents").get_by_text(f"Jury handbook {s}")).to_be_visible()
    adm.goto(f"{CONSOLE}/content?edition=2026&tab=emergency_contact")
    adm.get_by_role("button", name=re.compile("Add emergency")).click()
    f2 = adm.get_by_role("region", name="Edit item")
    f2.get_by_label("Title").fill(f"Campus medical room {s}")
    f2.get_by_label("Phone number").fill("+91 98765 43210")
    f2.get_by_label("All participants").check()
    f2.get_by_role("button", name="Save draft").click()
    ec = adm.get_by_role("region", name=f"Campus medical room {s}")
    ec.get_by_role("button", name="Publish").click()
    ec.get_by_label("What changed").fill("Medical room added")
    ec.get_by_role("button", name="Confirm publish").click()
    expect(ec.get_by_text("Published v1")).to_be_visible()
    shot(adm, "e3-console-documents")
    adm.close()

    # ---- app: juror sees programme, 112 first, the jury document; volunteer does not see it
    ctx, app = app_sign_in(browser, JUROR)
    app.get_by_role("button", name="Programme and event information").click()
    app.wait_for_url(re.compile(r"/event"))
    expect(app.get_by_text("Startup pitches")).to_be_visible()
    expect(app.get_by_text(f"11:00–13:00 · Main auditorium {s}")).to_be_visible()
    expect(app.get_by_role("button", name=re.compile(r"^Call National emergency number"))).to_be_visible()
    expect(app.get_by_text(f"Campus medical room {s}", exact=False)).to_be_visible()
    expect(app.get_by_text(f"Jury handbook {s}")).to_be_visible()
    shot(app, "e4-app-event-juror")
    jctx, japp = ctx, app

    vctx, vapp = app_sign_in(browser, VOL)
    vapp.get_by_role("button", name="Programme and event information").click()
    vapp.wait_for_url(re.compile(r"/event"))
    expect(vapp.get_by_text("Startup pitches")).to_be_visible()
    expect(vapp.get_by_text(f"Jury handbook {s}")).to_have_count(0)

    # ---- AT-24: a change made once appears on the website without any release
    con.goto(f"{CONSOLE}/content?edition=2026&tab=schedule_item")
    edit_pitches(con, "14:00", "16:00", f"Seminar hall {s}", "Moved to the afternoon")
    web.reload()
    friday = web.get_by_role("region", name="Friday, 18 December 2026")
    expect(friday.get_by_text("14:00–16:00")).to_be_visible()
    expect(friday.get_by_text(f"Seminar hall {s}")).to_be_visible()
    japp.reload()
    expect(japp.get_by_text(f"14:00–16:00 · Seminar hall {s}")).to_be_visible()

    # ---- AT-25: a jury-only notice reaches jurors and nobody else; corrected, then withdrawn
    con.get_by_role("link", name="Notices").click()
    con.wait_for_url(re.compile(r"/notices"))
    compose = con.get_by_role("region", name="New notice")
    compose.get_by_label("Title").fill(f"Jury briefing {s}")
    compose.get_by_label("Message").fill("The jury briefing is at 09:00 in the board room.")
    compose.get_by_label("Selected roles").check()
    compose.get_by_label("Jury members").check()
    compose.get_by_role("button", name="Check recipients").click()
    expect(compose.get_by_role("status")).to_contain_text("will see it in the app")
    compose.get_by_role("button", name=re.compile(r"^Publish to \d+ (person|people)")).click()
    expect(con.get_by_role("status").first).to_contain_text("Notice published")
    published = con.get_by_role("region", name=f"Notice: Jury briefing {s}")
    expect(published.get_by_text(re.compile(r"To Jury members · \d+ (person|people)"))).to_be_visible()
    shot(con, "e5-console-notices")

    japp.goto(f"{APP}/notifications")
    expect(japp.get_by_text(f"Jury briefing {s}")).to_be_visible()
    vapp.goto(f"{APP}/notifications")
    vapp.wait_for_load_state("networkidle")
    expect(vapp.get_by_text(f"Jury briefing {s}")).to_have_count(0)
    shot(japp, "e6-app-juror-notice")

    published.get_by_role("button", name="Correct").click()
    published.get_by_label("Message").fill("The jury briefing is now at 09:30 in the board room.")
    published.get_by_label(re.compile("Why are you correcting")).fill("Time changed")
    published.get_by_role("button", name="Save correction").click()
    expect(con.get_by_role("status").first).to_contain_text("Corrected")
    japp.reload()
    expect(japp.get_by_text("The jury briefing is now at 09:30 in the board room.")).to_be_visible()
    published = con.get_by_role("region", name=f"Notice: Jury briefing {s}")
    published.get_by_role("button", name="Withdraw").click()
    published.get_by_label(re.compile("Why are you withdrawing")).fill("Briefing cancelled")
    published.get_by_role("button", name="Confirm withdrawal").click()
    expect(con.get_by_role("status").first).to_contain_text("Withdrawn")
    expect(published.get_by_text("Withdrawn", exact=True)).to_be_visible()
    japp.reload()
    expect(japp.get_by_text(f"Jury briefing {s}")).to_have_count(0)
    browser.close()
print("E2E event information and notices (Phase 7) passed, run", s)
