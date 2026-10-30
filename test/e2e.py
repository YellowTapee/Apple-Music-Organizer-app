"""Browser tests for the UI, run against the FAKE test server (test/e2e-fake-server.js).

These verify UI behaviour and failure-state handling. They do NOT prove anything
about real Apple Music; see docs/VERIFICATION.md.

Requires: python3, `pip install playwright`, `playwright install chromium`.
Run:      python3 test/e2e.py [screenshot_dir]
"""
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
if SHOTS:
    os.makedirs(SHOTS, exist_ok=True)

PASSED = []


def check(name, cond, detail=""):
    if not cond:
        raise AssertionError(f"FAIL: {name} {detail}")
    PASSED.append(name)
    print("ok  -", name)


LIVE = []


class FakeServer:
    def __init__(self, mode, port):
        self.mode, self.port = mode, port
        env = dict(os.environ, MODE=mode, PORT=str(port))
        self.proc = subprocess.Popen(
            ["node", os.path.join(ROOT, "test", "e2e-fake-server.js")],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        LIVE.append(self)
        first = self.proc.stdout.readline()  # "fake test server ... on PORT"
        if "on " + str(port) not in first:
            raise RuntimeError(f"fake server did not start on {port}: {first!r}")
        self.url = f"http://127.0.0.1:{port}"

    def writes(self):
        # Non-blocking drain of whatever was printed so far.
        import select
        lines = []
        while select.select([self.proc.stdout], [], [], 0.2)[0]:
            line = self.proc.stdout.readline()
            if not line:
                break
            if line.startswith("WRITE "):
                lines.append(line.strip())
        return lines

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=5)


def shot(page, name):
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)


def no_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ================= happy path (desktop) =================
        srv = FakeServer("ok", 4180)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors, dialogs = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.goto(srv.url)

        expect(page.locator("#connection")).to_have_text("Connected to Music")
        check("connection pill shows connected", True)
        options = page.locator("#playlist option").all_inner_texts()
        check("system playlists are hidden", not any("Recently Added" in o for o in options), str(options))
        expect(page.locator("[data-action=to-artists]")).to_be_disabled()
        check("Continue disabled until a playlist is chosen", True)
        shot(page, "1-playlist")

        page.select_option("#playlist", "P1")
        page.click("[data-action=to-artists]")
        expect(page.get_by_role("heading", name="Choose artists")).to_be_visible()
        expect(page.locator("#to-review")).to_be_disabled()
        check("Continue disabled until an artist is selected", True)
        check("source card is labelled", page.locator("#app .card.source").inner_text().lower().count("will not change") == 1)

        # primary-only counts and search
        check("Drake shows 5 primary tracks", "5 tracks" in page.locator("label", has_text="Drake").first.text_content())
        page.fill("#search", "sza")
        check("search filters artists", page.locator("#artist-list li").count() == 1)
        page.check("[data-artist='SZA']")
        page.fill("#search", "")
        page.check("[data-artist='Tyler, The Creator']")
        check("selection summary updates", "2 selected" in page.locator("#artist-summary").inner_text())
        shot(page, "2-artists")

        page.click("#to-review")
        expect(page.get_by_role("heading", name="Review matching songs")).to_be_visible()
        check("review shows 5 matching tracks", page.locator("ul[aria-label='Matching tracks'] li").count() == 5)
        order = page.locator(".track .pos").all_text_contents()
        check("original playlist order preserved", order == sorted(order, key=int), str(order))
        page.locator('[data-track-position]').first.uncheck()
        check("unchecking preserves the song for reselection", page.locator('[data-track-position]:checked').count() == 4 and page.locator('[data-track-position]').count() == 5)
        page.click('[data-action=deselect-all-tracks]')
        check("deselect all blocks continuation", page.locator('[data-track-position]:checked').count() == 0 and page.locator('[data-action=to-confirm]').is_disabled())
        page.locator('[data-track-position]').first.check()
        check("one song can be selected individually", page.locator('[data-track-position]:checked').count() == 1)
        page.click('[data-action=select-all-tracks]')
        check("select all checks every matching song", page.locator('[data-track-position]:checked').count() == 5)
        shot(page, "3-review")

        page.click("[data-action=to-confirm]")
        expect(page.get_by_role("heading", name="Name and confirm")).to_be_visible()
        check("source and destination are separate cards", page.locator("#app .card.source").count() == 1 and page.locator("#app .card.dest").count() == 1)
        check("source-unchanged warning is shown", "not" in page.locator(".banner-info").inner_text().lower())
        dest_default = page.input_value("#dest")
        check("default destination name is filled in", "SZA" in dest_default, dest_default)

        page.fill("#dest", "   ")
        expect(page.locator("#copy-btn")).to_be_disabled()
        check("empty name disables Copy", True)
        page.fill("#dest", "FAKE TEST: 20 track playlist")
        expect(page.locator("#dest-problem")).to_contain_text("already exists")
        expect(page.locator("#copy-btn")).to_be_disabled()
        check("existing playlist name is refused (no overwrite)", True)
        page.fill("#dest", "Sorted copy")
        shot(page, "4-confirm")

        # preview-only never writes
        page.check("#preview")
        page.click("#copy-btn")
        expect(page.get_by_role("heading", name="Preview only")).to_be_visible()
        check("preview-only shows what would be copied, writes nothing", srv.writes() == [])
        page.click("[data-action=back-to-confirm]")
        page.uncheck("#preview")

        # cancel in the confirmation dialog -> still nothing written
        page.click("#copy-btn")
        expect(page.locator("#confirm-dialog")).to_be_visible()
        page.click("button[value=cancel]")
        check("cancelling the confirmation writes nothing", srv.writes() == [])

        # confirm -> exactly one write, double-submit blocked
        page.click("#copy-btn")
        page.click("#confirm-ok")
        expect(page.locator("#copy-btn")).to_be_disabled()
        expect(page.locator("#copy-btn")).to_contain_text("Copying")
        check("button is disabled and relabelled while copying", True)
        expect(page.get_by_role("heading", name="Results")).to_be_visible()
        writes = srv.writes()
        check("exactly one write reached Music", len(writes) == 1, str(writes))
        check("write contained the 5 tracks", '"requested":5' in writes[0] and '"copied":5' in writes[0], writes[0])
        body = page.locator("#app").inner_text()
        check("results report success", "All tracks copied" in body)
        check("results show copied/skipped/failed", page.locator(".stat b").all_inner_texts() == ["5", "0", "0"])
        check("source-unchanged check is reported", "same tracks in the same order" in body)
        shot(page, "5-results")

        # start another; name collision now detected for the created playlist
        page.click("[data-action=restart]")
        page.select_option("#playlist", "P1")
        page.click("[data-action=to-artists]")
        page.check("[data-artist='SZA']")
        page.click("#to-review")
        page.click("[data-action=to-confirm]")
        page.fill("#dest", "Sorted copy")
        expect(page.locator("#dest-problem")).to_contain_text("already exists")
        check("a playlist created this session can't be silently reused", True)

        # selections survive going back
        page.click("[data-action=back]")  # to review
        page.click("[data-action=back]")  # to artists
        check("artist selection survives navigating back", page.locator("[data-artist='SZA']").is_checked())

        # ---- hostile metadata is escaped, never executed ----
        page.click("[data-action=back]")
        page.select_option("#playlist", "P2")
        page.click("[data-action=to-artists]")
        page.check("[data-artist='Evil & Co']")
        page.click("#to-review")
        check("script/img in metadata is not injected", page.locator("#app img, #app script").count() == 0)
        check("markup in metadata is shown as literal text", "<img src=x" in page.locator(".track .title").first.text_content())
        check("no JS dialogs fired", dialogs == [], str(dialogs))

        # ---- empty playlist ----
        page.click("[data-action=back]")
        page.click("[data-action=back]")
        page.select_option("#playlist", "P3")
        page.click("[data-action=to-artists]")
        expect(page.locator("#artist-list")).to_contain_text("no tracks")
        expect(page.locator("#to-review")).to_be_disabled()
        check("empty playlist shows an empty state and blocks Continue", True)

        check("no uncaught JS errors (desktop)", errors == [], str(errors))
        ctx.close()
        srv.stop()

        # ================= mobile layout =================
        srv = FakeServer("ok", 4181)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page = ctx.new_page()
        merrors = []
        page.on("pageerror", lambda e: merrors.append(str(e)))
        page.goto(srv.url)
        expect(page.locator("#playlist")).to_be_visible()
        check("mobile: step 1 has no horizontal scroll", no_overflow(page))
        shot(page, "m1-playlist")
        page.select_option("#playlist", "P1")
        page.click("[data-action=to-artists]")
        check("mobile: step 2 has no horizontal scroll", no_overflow(page))
        shot(page, "m2-artists")
        page.check("[data-artist='Drake']")
        page.click("#to-review")
        check("mobile: step 3 has no horizontal scroll", no_overflow(page))
        shot(page, "m3-review")
        page.click("[data-action=to-confirm]")
        check("mobile: step 4 has no horizontal scroll", no_overflow(page))
        shot(page, "m4-confirm")
        btn = page.locator("#copy-btn").bounding_box()
        check("mobile: primary button is a comfortable tap target", btn["height"] >= 44, str(btn))
        check("no uncaught JS errors (mobile)", merrors == [], str(merrors))
        ctx.close()
        srv.stop()

        # ================= failure halfway =================
        srv = FakeServer("fail-halfway", 4182)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto(srv.url)
        page.select_option("#playlist", "P1")
        page.click("[data-action=to-artists]")
        page.check("[data-artist='Drake']")
        page.check("[data-artist='Future']")
        page.click("#to-review")
        total = page.locator("ul[aria-label='Matching tracks'] li").count()
        page.click("[data-action=to-confirm]")
        page.fill("#dest", "Halfway test")
        page.click("#copy-btn")
        page.click("#confirm-ok")
        expect(page.get_by_role("heading", name="Results")).to_be_visible()
        stats = [int(x) for x in page.locator(".stat b").all_inner_texts()]
        check("partial result is labelled partial, not success", "Partly copied" in page.locator("#app").inner_text())
        check("copied + failed accounts for every track", stats[0] == 2 and stats[2] == total - 2 and stats[0] + stats[2] == total, f"{stats} total={total}")
        check("track-level failure reasons are shown", "Connection is invalid" in page.locator("#app").inner_text() and "not attempted" in page.locator("#app").inner_text())
        check("aborted copy gets an explicit explanation", "The copy stopped early" in page.locator("#app").inner_text())
        check("every failed track is listed (not just the visible ones)", page.locator("#app ul.list li").count() == total - 2, str(page.locator("#app ul.list li").count()))
        check("title, artist and reason are on separate lines", page.locator("#app .track .title").first.evaluate("e => getComputedStyle(e).display") == "block")
        shot(page, "6-partial")
        page.click("[data-action=retry-failed]")
        expect(page.get_by_role("heading", name="Name and confirm")).to_be_visible()
        check("retry goes to a NEW playlist name, never the existing one", page.input_value("#dest") == "Halfway test (retry)", page.input_value("#dest"))
        check("retry covers only the failed tracks", f"<b>{total - 2}</b>" in page.locator("#app .card.dest").inner_html())
        ctx.close()
        srv.stop()

        # ================= connection / permission states =================
        for mode, port, pill, needle in [
            ("permission-denied", 4183, "Permission needed", "Automation"),
            ("music-closed", 4184, "Music is closed", "Open the Music app"),
            ("unsupported", 4185, "Not running on a Mac", "must run on the Mac"),
        ]:
            srv = FakeServer(mode, port)
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            page = ctx.new_page()
            page.goto(srv.url)
            expect(page.locator("#connection")).to_have_text(pill)
            expect(page.locator("#app .banner-error")).to_contain_text(needle)
            expect(page.locator("[data-action=to-artists]")).to_be_disabled()
            check(f"{mode}: shows real state, instructions, and blocks Continue", True)
            shot(page, f"7-{mode}")
            ctx.close()
            srv.stop()

        srv = FakeServer("empty", 4186)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(srv.url)
        expect(page.locator("#app")).to_contain_text("No playlists found")
        check("empty library shows an empty state", True)
        ctx.close()
        srv.stop()

        # helper not running at all
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto("data:text/html,<p>x</p>")
        ctx.close()

        # Direct browsing, persistent selection through search, and local history.
        srv = FakeServer('ok', 4198)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(srv.url)
        page.select_option('#playlist', 'P1')
        page.click('[data-action=to-artists]')
        page.click('[data-action=browse-songs]')
        check('direct browsing starts with nothing selected', page.locator('[data-track-position]:checked').count() == 0)
        page.fill('#song-search', 'Drake')
        page.locator('[data-track-position]').first.check()
        selected_position = page.locator('[data-track-position]:checked').first.get_attribute('data-track-position')
        page.fill('#song-search', 'SZA')
        page.click('[data-action=select-all-tracks]')
        page.fill('#song-search', '')
        check('search preserves checked songs from other artists', page.locator(f'[data-track-position="{selected_position}"]').is_checked())
        selected_count = page.locator('[data-track-position]:checked').count()
        page.click('[data-action=to-confirm]')
        page.fill('#dest', 'Direct browse test')
        page.click('#copy-btn')
        page.click('#confirm-ok')
        expect(page.get_by_role('heading', name='Results')).to_be_visible()
        saved = page.evaluate('JSON.parse(localStorage.getItem("organizer/copied-tracks/v1"))')
        check('only copied songs recorded in local progress', len(saved['P1']) == selected_count)
        page.reload()
        page.select_option('#playlist', 'P1')
        page.click('[data-action=to-artists]')
        page.click('[data-action=browse-songs]')
        hidden_count = page.locator('[data-track-position]').count()
        page.check('#show-organized')
        check('copied songs hidden after reload and available via toggle', page.locator('[data-track-position]').count() == hidden_count + selected_count)
        ctx.close()
        srv.stop()

        browser.close()
    print(f"\n{len(PASSED)} browser checks passed")


if __name__ == "__main__":
    try:
        main()
    finally:
        for server in LIVE:
            server.stop()

