"""Seeds demo data into proofy-dev (branch seed-dev only).

Steps: inspect -> (optional reset) -> seed.sql -> photos -> verify.
SQL goes through the Supabase Management API; photos through the Storage REST API with the
service-role key (masked). Never prints secrets or e-mail addresses.

Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, optional SEED_RESET=1 (delete the seeded group
and its photos first).
"""

import io
import json
import os
import random
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont

TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = os.environ["SUPABASE_PROJECT_REF"]
API = f"https://api.supabase.com/v1/projects/{REF}"
PROJECT_URL = f"https://{REF}.supabase.co"
A = "5fbe3b3e-92e1-40a2-9d43-9f2c087ce0e7"
B = "90be1de9-74cd-4802-9507-0409e2549b39"
GROUP = "Epic 4 Test Crew"
HERE = os.path.dirname(os.path.abspath(__file__))


def http(method, url, headers, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def q(sql):
    status, body = http(
        "POST",
        f"{API}/database/query",
        {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "seed-dev",
        },
        json.dumps({"query": sql}).encode(),
    )
    if status >= 300:
        print(f"SQL failed ({status}): {body.decode(errors='replace')[:3000]}")
        sys.exit(1)
    return json.loads(body or b"[]")


def show(title, rows):
    print(f"\n== {title} ==")
    for r in rows:
        print("  " + json.dumps(r, default=str, ensure_ascii=False))


def group_id():
    rows = q(f"select id from public.groups where name = '{GROUP}' and created_by = '{A}'")
    return rows[0]["id"] if rows else None


def service_key():
    status, body = http(
        "GET",
        f"{API}/api-keys?reveal=true",
        {"Authorization": f"Bearer {TOKEN}", "User-Agent": "seed-dev"},
    )
    if status >= 300:
        print(f"api-keys failed ({status})")
        sys.exit(1)
    keys = json.loads(body)
    key = next((k["api_key"] for k in keys if k.get("name") == "service_role"), None)
    if not key:
        key = next((k["api_key"] for k in keys if k.get("type") == "secret"), None)
    if not key:
        print("no service-role or secret key found")
        sys.exit(1)
    print(f"::add-mask::{key}")
    return key


def storage_headers(key, extra=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}", "User-Agent": "seed-dev"}
    h.update(extra or {})
    return h


def inspect():
    show(
        "profiles",
        q(
            f"""select id, display_name, time_zone, pending_time_zone
                from public.profiles where id in ('{A}', '{B}')"""
        ),
    )
    show(
        "current groups of A and B",
        q(
            f"""select g.name, m.user_id, m.role from public.memberships m
                join public.groups g on g.id = m.group_id
                where m.user_id in ('{A}', '{B}') and m.ended_at is null order by g.name"""
        ),
    )
    show("latest migrations", q("select version from supabase_migrations.schema_migrations order by version desc limit 3"))
    show("heartbeat", q("select last_run_at, last_error_step, last_error from public.heartbeat"))


def reset(key):
    gid = group_id()
    if not gid:
        print("reset: no group")
        return
    names = [r["name"] for r in q(f"select name from storage.objects where bucket_id = 'checkins' and name like '{gid}/%'")]
    for i in range(0, len(names), 100):
        status, body = http(
            "DELETE",
            f"{PROJECT_URL}/storage/v1/object/checkins",
            storage_headers(key, {"Content-Type": "application/json"}),
            json.dumps({"prefixes": names[i : i + 100]}).encode(),
        )
        if status >= 300:
            print(f"reset: storage delete failed ({status}): {body[:500]!r}")
            sys.exit(1)
    q(f"delete from public.groups where id = '{gid}'")
    print(f"reset: deleted group {gid} and {len(names)} photos")


PALETTES = {
    "Gym": ((40, 44, 52), (231, 111, 81)),
    "Read": ((246, 235, 214), (122, 82, 48)),
    "Run": ((32, 92, 120), (240, 200, 80)),
    "Meditate": ((70, 60, 110), (200, 190, 240)),
    "Clean": ((210, 236, 230), (40, 120, 100)),
    "Errands": ((250, 225, 200), (150, 70, 40)),
}


def font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def photo(activity, label, seed):
    """A 810x1080 portrait 'photo': gradient, soft shapes, the activity and the local time."""
    rnd = random.Random(seed)
    bg, fg = PALETTES.get(activity, ((60, 60, 60), (230, 230, 230)))
    w, h = 810, 1080
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(bg[i] * (1 - 0.35 * t) + fg[i] * 0.12 * t) for i in range(3)))
    for _ in range(7):
        r = rnd.randint(60, 220)
        x, y = rnd.randint(-50, w + 50), rnd.randint(-50, h + 50)
        col = tuple(min(255, int(c * 0.6 + bg[i] * 0.4)) for i, c in enumerate(fg))
        d.ellipse([x - r, y - r, x + r, y + r], outline=col, width=rnd.randint(6, 18))
    d.text((60, 700), activity, font=font(120), fill=fg)
    d.text((64, 860), label, font=font(44), fill=fg)
    full = io.BytesIO()
    img.save(full, "WEBP", quality=80)
    small = io.BytesIO()
    img.resize((270, 360), Image.LANCZOS).save(small, "WEBP", quality=80)
    return full.getvalue(), small.getvalue()


def photos(key):
    gid = group_id()
    if not gid:
        print("photos: no group")
        sys.exit(1)
    rows = q(
        f"""select c.id, coalesce(pa.name, ga.custom_name) as activity,
                   to_char(c.captured_at at time zone p.time_zone, 'Dy DD Mon, HH24:MI') as label
            from public.checkins c
            join public.commitments cm on cm.id = c.commitment_id
            join public.group_activities ga on ga.id = cm.group_activity_id
            left join public.preset_activities pa on pa.key = ga.preset_key
            join public.profiles p on p.id = c.user_id
            where c.group_id = '{gid}' order by c.captured_at"""
    )
    have = {
        r["name"]
        for r in q(f"select name from storage.objects where bucket_id = 'checkins' and name like '{gid}/%'")
    }
    uploaded = 0
    for r in rows:
        paths = {s: f"{gid}/{r['id']}/{s}.webp" for s in ("1080", "360")}
        if all(p in have for p in paths.values()):
            continue
        full, small = photo(r["activity"], r["label"], r["id"])
        for size, data in (("1080", full), ("360", small)):
            status, body = http(
                "POST",
                f"{PROJECT_URL}/storage/v1/object/checkins/{paths[size]}",
                storage_headers(key, {"Content-Type": "image/webp", "x-upsert": "true", "Cache-Control": "3600"}),
                data,
            )
            if status >= 300:
                print(f"upload failed ({status}) for {paths[size]}: {body[:300]!r}")
                sys.exit(1)
            uploaded += 1
    print(f"photos: {len(rows)} check-ins, {uploaded} objects uploaded")


def verify():
    gid = group_id()
    if not gid:
        print("verify: no group")
        sys.exit(1)
    print(f"\nGroup: {GROUP} ({gid})")
    show("group", q(f"select name, time_zone, created_at from public.groups where id = '{gid}'"))
    show(
        "weeks",
        q(
            f"""select gw.week_start, gw.lock_at, gw.locked_at, r.ranked, r.winner_user_ids,
                       r.goal_target, r.goal_average, r.goal_hit
                from public.group_weeks gw
                left join public.group_week_results r using (group_id, week_start)
                where gw.group_id = '{gid}' order by gw.week_start"""
        ),
    )
    show(
        "week results",
        q(
            f"""select wr.week_start, p.display_name, wr.weekly_points, wr.sessions_done,
                       wr.sessions_planned, wr.rank
                from public.week_results wr join public.profiles p on p.id = wr.user_id
                where wr.group_id = '{gid}' order by wr.week_start, wr.rank"""
        ),
    )
    show(
        "streak_after per commitment",
        q(
            f"""select r.week_start, p.display_name, coalesce(pa.name, cm.name) as what, r.planned,
                       r.done, r.target_met, r.streak_after
                from public.week_commitment_results r
                join public.commitments cm on cm.id = r.commitment_id
                join public.group_activities ga on ga.id = cm.group_activity_id
                left join public.preset_activities pa on pa.key = ga.preset_key
                join public.profiles p on p.id = cm.user_id
                where r.group_id = '{gid}' order by p.display_name, what, r.week_start"""
        ),
    )
    show(
        "this week (live ranking)",
        q(
            f"""select p.display_name, r.weekly_points, r.sessions_done, r.sessions_planned, r.rank
                from private.group_ranking('{gid}', private.group_current_week('{gid}', now())) r
                join public.profiles p on p.id = r.user_id"""
        ),
    )
    show(
        "current streaks",
        q(
            f"""select p.display_name, coalesce(pa.name, cm.name) as what,
                       private.current_streak(cm.id) as streak
                from public.commitments cm
                join public.group_activities ga on ga.id = cm.group_activity_id
                left join public.preset_activities pa on pa.key = ga.preset_key
                join public.profiles p on p.id = cm.user_id
                where cm.group_id = '{gid}' and cm.kind = 'commitment' order by 1, 2"""
        ),
    )
    show(
        "badges",
        q(
            f"""select p.display_name, a.badge_key, a.week_start
                from public.badge_awards a join public.profiles p on p.id = a.user_id
                where a.group_id = '{gid}' order by p.display_name, a.week_start, a.badge_key"""
        ),
    )
    show(
        "all-time points and titles",
        q(
            f"""select p.display_name, private.all_time_points(m.id) as points,
                       private.title_for_points(private.all_time_points(m.id)) as title
                from public.memberships m join public.profiles p on p.id = m.user_id
                where m.group_id = '{gid}' and m.ended_at is null"""
        ),
    )
    show(
        "feed",
        q(
            f"""select kind, count(*) from public.feed_events where group_id = '{gid}' group by kind
                union all select 'checkins', count(*) from public.checkins where group_id = '{gid}'
                union all select 'photo objects', count(*) from storage.objects
                  where bucket_id = 'checkins' and name like '{gid}/%'"""
        ),
    )
    show(
        "feed events (winner, goal)",
        q(
            f"""select kind, created_at, payload - 'winners' as payload from public.feed_events
                where group_id = '{gid}' and kind in ('weekly_winner', 'goal_result')
                order by created_at"""
        ),
    )
    show(
        "group goal now",
        q(
            f"""select g.target_pct, g.period, private.goal_live_average('{gid}', private.group_current_week('{gid}', now())) as live_average
                from private.goal_for_week('{gid}', private.group_current_week('{gid}', now())) g"""
        ),
    )


def main():
    inspect()
    key = service_key()
    if os.environ.get("SEED_RESET") == "1":
        reset(key)
    with open(os.path.join(HERE, "seed.sql"), encoding="utf-8") as f:
        existed = group_id() is not None
        q(f.read())
        print("\nseed: group already existed, seed skipped" if existed else "\nseed: done")
    photos(key)
    verify()


if __name__ == "__main__":
    main()
