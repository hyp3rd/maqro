-- Unicode-NFC re-key of the micronutrient join key (`name_key`).
--
-- `foodNameKey` (the join key between a logged food and its enriched profile)
-- now Unicode-NFC-normalizes the lowercased name, so the SAME visual name in
-- different encoding forms — "café" as a single codepoint vs "cafe" + a
-- combining accent — keys identically instead of producing two profiles for one
-- food. The reader applies NFC AFTER lowercasing; the stored `name_key` values
-- were already written lowercased by the old key, so re-keying is exactly
-- `normalize(name_key, NFC)` — the same operation the reader does on the same
-- already-lowercased string (Postgres `normalize()` and JS `String.normalize`
-- implement the identical Unicode algorithm, so there is no byte-drift). This is
-- NOT accent-folding: "café" stays distinct from "cafe".
--
-- Re-keying can collapse two previously-distinct rows onto one key, which would
-- violate `unique (user_id, name_key)`. So we DELETE the collision losers first
-- (keeping the best by source quality, then recency), THEN re-key the survivors
-- — after the dedup every (user_id, NFC(name_key)) group has exactly one row, so
-- the update can't collide. Service-role migration; bypasses RLS.

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Drop collision losers: within each (user_id, NFC(name_key)) group keep the
-- highest source rank (barcode > ciqual > search > ai > miss), tie-broken by the
-- most recent enrichment (then id, for determinism).
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, normalize(name_key, nfc)
      order by
        case source
          when 'barcode' then 4
          when 'ciqual' then 3
          when 'search' then 2
          when 'ai' then 1
          else 0
        end desc,
        enriched_at desc,
        id desc
    ) as rn
  from public.micronutrient_profiles
)
delete from public.micronutrient_profiles p
using ranked r
where p.id = r.id
  and r.rn > 1;

update public.micronutrient_profiles
set name_key = normalize(name_key, nfc)
where name_key <> normalize(name_key, nfc);

-- ── Queue ───────────────────────────────────────────────────────────────────
-- The drain queue shares the same join key + unique constraint. It has no
-- source/enriched_at, so prefer the row carrying a barcode (more useful to the
-- cron), then the most recently created.
with ranked_q as (
  select
    id,
    row_number() over (
      partition by user_id, normalize(name_key, nfc)
      order by (off_code is not null) desc, created_at desc, id desc
    ) as rn
  from public.micronutrient_queue
)
delete from public.micronutrient_queue q
using ranked_q r
where q.id = r.id
  and r.rn > 1;

update public.micronutrient_queue
set name_key = normalize(name_key, nfc)
where name_key <> normalize(name_key, nfc);

-- ── Verification (run after applying) ────────────────────────────────────────
-- Zero rows expected from each — no remaining non-NFC keys, no dup groups:
--   select count(*) from public.micronutrient_profiles
--     where name_key <> normalize(name_key, nfc);
--   select user_id, name_key, count(*) from public.micronutrient_profiles
--     group by user_id, name_key having count(*) > 1;
--   select max(char_length(name_key)) from public.micronutrient_profiles;  -- <= 200
