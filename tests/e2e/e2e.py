# End-to-end test: real pages + real Netlify function code + fake Firebase.  python3 tests/e2e/e2e.py [port]
import asyncio, json, sys, os, urllib.request
from playwright.async_api import async_playwright
PORT = sys.argv[1] if len(sys.argv) > 1 else '8790'; B = f'http://localhost:{PORT}'; HERE = os.path.dirname(__file__)
D = 'sathyabama.ac.in'; errors = []; fails = []
def srv(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')
def check(name, cond, extra=''):
    print(('  ✔ ' if cond else '  ✘ ') + name + (f'  [{extra}]' if extra and not cond else '')); 
    if not cond: fails.append(name)
async def new_ctx(br, w=1280, h=900):
    c = await br.new_context(viewport={'width': w, 'height': h})
    async def fake(route):
        name = route.request.url.split('/')[-1].split('?')[0]
        f = {'firebase-app.js': 'fake-app.js', 'firebase-auth.js': 'fake-auth.js', 'firebase-firestore.js': 'fake-firestore.js'}[name]
        body = open(os.path.join(HERE, f)).read().replace('__ORIGIN__', B)
        await route.fulfill(status=200, content_type='application/javascript', headers={'access-control-allow-origin': '*'}, body=body)
    await c.route('https://www.gstatic.com/firebasejs/**', fake)
    await c.route('https://fonts.googleapis.com/**', lambda r: r.abort()); await c.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg = await c.new_page()
    pg.on('pageerror', lambda e: errors.append((pg.url, str(e))))
    pg.on('console', lambda m: errors.append((pg.url, m.text)) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    return c, pg
async def sign_in(pg, email):
    await pg.goto(B + '/login.html'); await pg.fill('#email', email); await pg.click('#email-form button[type=submit]'); await pg.wait_for_selector('#sent:not(.hidden)')
    await pg.goto(srv('/__test/last-link?email=' + email)['url']); await pg.wait_for_timeout(900)
async def onboard(pg, name, year, dept, skills):
    await pg.wait_for_selector('#onb-form'); await pg.fill('#name', name); await pg.select_option('#year', str(year)); await pg.select_option('#dept', dept)
    for s in skills:
        await pg.click('#skills .add'); await pg.keyboard.type(s); await pg.keyboard.press('Enter')
    await pg.click('#onb-form button[type=submit]'); await pg.wait_for_url('**/board.html'); await pg.wait_for_selector('#count')
async def toast_text(pg):
    await pg.wait_for_selector('.note', timeout=4000); return await pg.inner_text('.note')

async def main():
    srv('/__test/reset', {})
    async with async_playwright() as p:
        br = await p.chromium.launch()
        print('\n[1] Auth guards & sign-in'); 
        cm, maya = await new_ctx(br)
        await maya.goto(B + '/board.html'); await maya.wait_for_url('**/login.html'); check('signed-out visitor is sent to login', True)
        await maya.fill('#email', 'maya@gmail.com'); await maya.click('#email-form button[type=submit]'); await maya.wait_for_selector('#bad:not(.hidden)')
        check('non-college email is rejected on the client', await maya.is_visible('#bad'))
        await maya.goto(B + '/auth-complete.html'); check('link page without a valid link shows the expired state', await maya.is_visible('#expired'))
        await sign_in(maya, f'maya@{D}'); check('new student lands on onboarding', maya.url.endswith('/onboarding.html'), maya.url)
        await onboard(maya, 'Maya Patel', 1, 'Computer Science', ['Python'])
        check('onboarding saved → board', maya.url.endswith('/board.html'))
        uid = 'maya'; u = srv('/__test/doc?path=users/maya')['data']
        check('profile doc has forced defaults (karma 0, Newcomer, active)', u['karma'] == 0 and u['badge'] == 'Newcomer' and u['status'] == 'active' and u['onboarded'] is True)
        check('private contact doc created with her email', srv('/__test/doc?path=users/maya/private/contact')['data']['email'] == f'maya@{D}')
        ca, aarav = await new_ctx(br)
        await sign_in(aarav, f'aarav@{D}'); await onboard(aarav, 'Aarav Shah', 3, 'Computer Science', ['Data Structures', 'C++'])

        print('\n[2] Posts'); 
        await maya.goto(B + '/post-new.html'); await maya.click('#post-form button[type=submit]'); check('empty form shows validation error', await maya.is_visible('#errbox'))
        await maya.fill('#title', 'Data Structures study help'); await maya.fill('#desc', 'I am stuck on linked lists in C++. Free Thursday after 4.')
        for t in ['data structures', 'c++']: await maya.click('#addtag'); await maya.keyboard.type(t); await maya.keyboard.press('Enter')
        await maya.click('#desc'); await maya.fill('#desc', 'Call me on 9876543210'); await maya.click('#post-form button[type=submit]')
        check('phone number in a post is blocked', 'phone' in (await maya.inner_text('#errtxt')))
        await maya.fill('#desc', 'I am stuck on linked lists in C++. Free Thursday after 4.'); await maya.click('#post-form button[type=submit]'); await maya.wait_for_url('**/post.html?id=*')
        pid = maya.url.split('id=')[1]; await maya.wait_for_function("document.querySelector('#viewing').innerText.length>0"); check('post published (owner view)', 'Owner view' in await maya.inner_text('#viewing'))
        await aarav.goto(B + '/board.html'); await aarav.wait_for_selector('#grid .pcard')
        check("Aarav's board shows Maya's request with shared-tag highlight", 'Data Structures study help' in await aarav.inner_text('#grid') and await aarav.locator('#grid .pcard.match').count() == 1)
        check('right rail suggests nothing weird (no crash) and karma card renders', '0 karma' in await aarav.inner_text('#karma-n'))
        await aarav.fill('#q', 'linked'); await aarav.wait_for_timeout(700); check('text search finds the post', 'Data Structures study help' in await aarav.inner_text('#grid'))
        await aarav.fill('#q', 'zzzz'); await aarav.wait_for_timeout(700); check('empty search shows the empty state', await aarav.is_visible('#empty'))
        await aarav.fill('#q', 'c++'); await aarav.wait_for_timeout(700); check('tag search (array-contains) finds it', 'Data Structures study help' in await aarav.inner_text('#grid'))

        print('\n[3] Connect → accept → chat'); 
        await aarav.goto(B + '/post.html?id=' + pid); await aarav.click('#connect'); await aarav.click('.modal [data-x="1"]'); check('request sent toast', 'Request sent' in await toast_text(aarav))
        await aarav.wait_for_timeout(600); check('button now shows waiting state', 'Request sent' in await aarav.inner_text('#sc-act'))
        await maya.goto(B + '/inbox.html'); await maya.wait_for_selector('.reqcard.new')
        check('Maya sees the incoming request', 'Aarav Shah' in await maya.inner_text('#list') and 'Incoming · 1' in await maya.inner_text('#tabs'))
        check('sidebar inbox badge shows 1', (await maya.inner_text('[data-count="inbox"]')).strip() == '1')
        await maya.goto(B + '/notifications.html'); await maya.wait_for_selector('.notif'); check('Maya has a request notification', 'wants to help' in await maya.inner_text('#list'))
        await maya.goto(B + '/inbox.html'); await maya.wait_for_selector('[data-a=accept]'); await maya.click('[data-a=accept]'); check('accepted toast', 'Connected' in await toast_text(maya))
        await maya.wait_for_selector('#tabs button:has-text("Connected · 1")'); cid = [k for k in [maya.url]][0]
        await maya.click('#tabs button:has-text("Connected")'); await maya.wait_for_selector('a:has-text("Open chat")'); await maya.click('a:has-text("Open chat")'); await maya.wait_for_url('**/chat.html?id=*')
        chat_url = maya.url; await maya.wait_for_function("document.querySelector('#ch-who').innerText.length>0 && !!document.querySelector('#ctext').onkeydown"); check('chat opened for the pair', 'Aarav Shah' in await maya.inner_text('#ch-who'))
        check('first-time accept gave Maya +3 karma', srv('/__test/doc?path=users/maya')['data']['karma'] == 3)
        await aarav.goto(chat_url); await aarav.wait_for_function("document.querySelector('#ch-who').innerText.length>0 && !!document.querySelector('#ctext').onkeydown")
        await aarav.fill('#ctext', 'Hi Maya! Library at 4?'); await aarav.press('#ctext', 'Enter'); await maya.wait_for_selector('.msg:has-text("Library at 4")', timeout=4000); check('message arrives live on the other side', True)
        await maya.fill('#ctext', 'Perfect, see you there'); await maya.click('#send'); await aarav.wait_for_selector('.msg:has-text("see you there")', timeout=4000); check('reply arrives live', True)
        await maya.fill('#ctext', 'line1'); await maya.press('#ctext', 'Shift+Enter'); check('shift+enter does not send', await maya.locator('.msg:has-text("line1")').count() == 0)
        await maya.fill('#ctext', '')
        check('contact panel shows Aarav shared email', f'aarav@{D}' in await maya.inner_text('#contact'))
        check('chat doc lastMessage updated', 'see you there' in srv('/__test/doc?path=chats/' + chat_url.split('id=')[1])['data']['lastMessage'])

        print('\n[4] Mark as helped → karma, badge, notification, leaderboard')
        check('helper (Aarav) has no mark-as-helped button', not await aarav.is_visible('#helped'))
        await maya.click('#helped'); await maya.click('.modal [data-x="1"]'); check('thanks toast', 'earned' in await toast_text(maya))
        await maya.wait_for_timeout(700); check('button locked after confirming', await maya.is_disabled('#helped'))
        a = srv('/__test/doc?path=users/aarav')['data']; check('Aarav karma 10, helpedCount 1, badge Helper', (a['karma'], a['helpedCount'], a['badge']) == (10, 1, 'Helper'), str(a))
        await aarav.goto(B + '/notifications.html'); await aarav.wait_for_selector('.notif'); t = await aarav.inner_text('#list')
        check('Aarav notified about help + badge', 'marked you as helped' in t and 'Helper' in t)
        await aarav.click('#markall'); await aarav.wait_for_timeout(700); check('mark all read → unread 0', 'Unread · 0' in await aarav.inner_text('#tabs'))
        await aarav.goto(B + '/leaderboard.html'); await aarav.wait_for_selector('#rows .row'); check('leaderboard lists Aarav first', 'Aarav Shah' in (await aarav.inner_text('#rows .row')))
        await aarav.goto(B + '/me.html'); await aarav.wait_for_selector('#k-n'); check('profile shows karma + badge', '10 karma' in await aarav.inner_text('#k-n') and 'Helper' in await aarav.inner_text('#k-b'))
        check('progress bar moves toward Rising Mentor (10/25)', '10 / 25' in await aarav.inner_text('#k-t'))
        await aarav.goto(B + '/profile.html?id=maya'); await aarav.wait_for_selector('#h-chips'); check("public profile of Maya renders and hides contact", f'maya@{D}' not in await aarav.content())

        print('\n[5] Edit / close / delete / privacy')
        await maya.goto(B + '/post-edit.html?id=' + pid); await maya.wait_for_selector('#title'); check('category is read-only on edit', await maya.is_disabled('#cat'))
        await maya.fill('#title', 'Data Structures study help (updated)'); await maya.click('#post-form button[type=submit]'); await maya.wait_for_url('**/post.html?id=*'); await maya.wait_for_function("document.querySelector('#p-title').innerText.includes('updated')"); check('edit saved', True)
        await maya.goto(B + '/me.html'); await maya.wait_for_function("document.querySelector('#t-phone').innerText.length>0"); await maya.fill('#phone', '+919876543210'); await maya.click('#t-phone'); await maya.click('#save-priv'); check('privacy settings saved', 'saved' in (await toast_text(maya)).lower())
        c = srv('/__test/doc?path=users/maya/private/contact')['data']; check('contact doc stores phone + sharePhone', c['phone'] == '+919876543210' and c['sharePhone'] is True)
        await aarav.goto(chat_url); await aarav.wait_for_selector('#contact'); check('Aarav now sees her phone (she opted in)', '+919876543210' in await aarav.inner_text('#contact'))
        await maya.goto(B + '/post-edit.html?id=' + pid); await maya.wait_for_function("document.querySelector('#title').value.length>0"); await maya.click('#close'); await maya.click('.modal [data-x="1"]'); await maya.wait_for_url('**/me.html')
        await maya.wait_for_selector('#my-posts article'); check('closed post is marked Closed on profile', 'Closed' in await maya.inner_text('#my-posts'))
        await aarav.goto(B + '/board.html'); await aarav.wait_for_selector('#count'); check('closed post leaves the board', 'Data Structures study help' not in await aarav.inner_text('#grid'))

        print('\n[6] Reports → moderation → suspension')
        await aarav.goto(B + '/post-new.html'); await aarav.fill('#title', 'Paid answers for your next exam'); await aarav.fill('#desc', 'I can complete your graded assignment for a fee.')
        await aarav.click('#addtag'); await aarav.keyboard.type('assignments'); await aarav.keyboard.press('Enter'); await aarav.click('#post-form button[type=submit]'); await aarav.wait_for_url('**/post.html?id=*'); bad = aarav.url.split('id=')[1]
        await maya.goto(B + '/post.html?id=' + bad); await maya.wait_for_function("document.querySelector('#p-title').innerText.length>0"); await maya.click('#report'); await maya.select_option('#rr', 'other'); await maya.fill('#rd', 'Selling assignments'); await maya.click('.modal [data-x="1"]'); check('report accepted', 'moderator' in await toast_text(maya))
        await maya.wait_for_timeout(3300); await maya.click('#report'); await maya.click('.modal [data-x="1"]'); check('duplicate report refused with the server message', 'already reported' in await toast_text(maya))
        srv('/__test/set-role', {'email': f'alex@{D}', 'role': 'admin'}); srv('/__test/set-role', {'email': f'prof@{D}', 'role': 'faculty'})
        cx, alex = await new_ctx(br); await sign_in(alex, f'alex@{D}'); check('admin lands on Insights', alex.url.endswith('/insights.html'), alex.url)
        await alex.goto(B + '/admin-reports.html'); await alex.wait_for_selector('.qi'); check('report queue shows the post', 'Paid answers' in await alex.inner_text('#queue'))
        await alex.click('#hide'); check('note required', 'required' in await alex.inner_text('#note-err'))
        await alex.fill('#note', 'Sells graded work.'); await alex.click('#hide'); await alex.click('.modal [data-x="1"]'); check('post hidden toast', 'hidden' in (await toast_text(alex)).lower())
        await alex.wait_for_timeout(500); check('post status is hidden', srv('/__test/doc?path=posts/' + bad)['data']['status'] == 'hidden')
        await maya.goto(B + '/post.html?id=' + bad); await maya.wait_for_url('**/404.html'); check('hidden post is a 404 for other students', True)
        await aarav.goto(B + '/post.html?id=' + bad); await aarav.wait_for_selector('#p-title'); check('author can still open his hidden post', 'Hidden' in await aarav.inner_text('#p-meta'))
        await maya.goto(B + '/profile.html?id=aarav'); await maya.wait_for_function("document.querySelector('#h-name').innerText.length>0"); await maya.click('#h-report'); await maya.select_option('#rr', 'harassment'); await maya.click('.modal [data-x="1"]'); await toast_text(maya)
        await alex.goto(B + '/admin-reports.html'); await alex.wait_for_selector('.qi'); await alex.click('.qi:has-text("User: Aarav")'); await alex.fill('#note', 'Repeated misconduct.'); await alex.click('#suspend'); await alex.click('.modal [data-x="1"]'); await alex.wait_for_timeout(800)
        check('Aarav is suspended in the database', srv('/__test/doc?path=users/aarav')['data']['status'] == 'suspended')
        await alex.click('#tabs button:has-text("Action history")'); await alex.wait_for_function("document.querySelector('#queue').innerText.includes('User suspended')"); check('action history lists both decisions', 'Post hidden' in await alex.inner_text('#queue') and 'User suspended' in await alex.inner_text('#queue'))
        await aarav.goto(B + '/board.html'); await aarav.wait_for_url('**/suspended.html'); check('suspended student is locked to the suspended page', True)
        await aarav.goto(B + '/post-new.html'); await aarav.wait_for_url('**/suspended.html'); check('…and cannot reach other pages', True)

        print('\n[7] Role guards & insights')
        await maya.goto(B + '/admin-reports.html'); await maya.wait_for_url('**/board.html'); check('student cannot open moderation', True)
        await maya.goto(B + '/insights.html'); await maya.wait_for_url('**/board.html'); check('student cannot open insights', True)
        cf, prof = await new_ctx(br); await sign_in(prof, f'prof@{D}'); check('faculty lands on Insights', prof.url.endswith('/insights.html'))
        await prof.goto(B + '/admin-reports.html'); await prof.wait_for_url('**/insights.html'); check('faculty cannot open moderation', True)
        await prof.goto(B + '/insights.html'); await prof.wait_for_selector('#nodata:not(.hidden)'); check('insights shows "no data yet" before aggregation', True)
        await maya.goto(B + '/post-new.html'); await maya.fill('#title', 'Python buddy for weekend project'); await maya.fill('#desc', 'Looking for a teammate.'); await maya.click('#addtag'); await maya.keyboard.type('python'); await maya.keyboard.press('Enter'); await maya.click('#post-form button[type=submit]'); await maya.wait_for_url('**/post.html?id=*')
        srv('/__test/aggregate', {}); await prof.reload(); await prof.wait_for_selector('#tag-bars .bar'); check('after aggregation, the open tag appears', 'Python' in await prof.inner_text('#tag-bars'))
        check('summary counts: 1 open, 1 closed (+1 hidden not counted open)', (await prof.inner_text('#s-open')).strip() == '1' and (await prof.inner_text('#s-closed')).strip() == '1')
        check('weekly chart rendered', await prof.locator('#chart svg').count() == 1)
        await maya.goto(B + '/chat.html?id=nope'); await maya.wait_for_url('**/404.html'); check('unknown chat → 404', True)
        await maya.goto(B + '/definitely-not-a-page'); await maya.wait_for_selector('.err404 h1'); check('unknown URL serves the 404 page', 'Lost page' in await maya.inner_text('body'))

        print('\n[8] Unverified accounts & Google sign-in')
        cv, vv = await new_ctx(br); srv('/__test/unverify', {'email': f'vera@{D}'}); await sign_in(vv, f'vera@{D}')
        srv('/__test/unverify', {'email': f'vera@{D}'}); await vv.goto(B + '/board.html'); await vv.wait_for_url('**/verify.html'); check('unverified user is routed to verify', True)
        srv('/__test/verify', {'email': f'vera@{D}'}); await vv.click('#check'); await vv.wait_for_url('**/onboarding.html'); check('after verifying → onboarding', True)
        cg, gg = await new_ctx(br); await gg.goto(B + '/login.html'); await gg.evaluate(f"localStorage.setItem('fake_google_email','gina@{D}')"); await gg.click('#google'); await gg.wait_for_url('**/onboarding.html'); check('Google sign-in creates the account', True)
        await gg.evaluate("localStorage.setItem('fake_auth','')"); 
        cb, bb = await new_ctx(br); await bb.goto(B + '/login.html'); await bb.evaluate("localStorage.setItem('fake_google_email','x@gmail.com')"); await bb.click('#google'); await bb.wait_for_selector('#bad:not(.hidden)'); check('Google sign-in with a non-college account is refused', True)
        await br.close()
    real = [e for e in errors if 'Failed to fetch' not in e[1] and 'Missing or insufficient' not in e[1] and 'permission' not in e[1].lower()]
    print('\nPAGE ERRORS:', json.dumps(real[:8], indent=1)); print(f'\n{"ALL PASSED" if not fails else "FAILED: " + str(fails)}'); sys.exit(1 if fails or real else 0)
asyncio.run(main())
