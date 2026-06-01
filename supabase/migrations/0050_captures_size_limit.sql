-- Tighten the `captures` bucket's per-object size limit. Migration
-- 0005 created the bucket without `file_size_limit`, which falls back
-- to the Supabase project default (50 MB). Phone food photos run
-- 2-5 MB; 10 MB is generous headroom for a high-DPI burst-quality
-- frame, while still bounding the abuse window if a leaked capture
-- session URL is replayed (5-minute session TTL caps how many bytes
-- a single replay can push regardless, but defense-in-depth: a tight
-- per-object cap means a leaked URL can't fill a bucket with a single
-- multi-GB blob).
--
-- Idempotent: re-running this migration just re-sets the cap to the
-- same value.

update storage.buckets
   set file_size_limit = 10485760  -- 10 MiB in bytes
 where id = 'captures';
