WITH parsed AS (
  SELECT nq.id,
    ARRAY(
      SELECT CASE WHEN o ~ '^\s*\d{1,3}\s*%\s*$' THEN regexp_replace(o, '\D', '', 'g')::int END
      FROM unnest(nq.options) WITH ORDINALITY AS t(o, i)
      ORDER BY i
    ) AS nums
  FROM "NoteQuestion" nq
  WHERE nq.type = 'choice'
    AND cardinality(nq.options) >= 2
),
q AS (
  SELECT p.id, p.nums
  FROM parsed p
  WHERE NOT EXISTS (SELECT 1 FROM unnest(p.nums) AS n WHERE n IS NULL OR n > 100)
    AND (SELECT count(DISTINCT n) FROM unnest(p.nums) AS n) = cardinality(p.nums)
)
UPDATE "NoteQuestion" nq
SET type = 'percent',
    options = ARRAY(SELECT n::text FROM unnest(q.nums) WITH ORDINALITY AS t(n, i) ORDER BY i)
FROM q WHERE nq.id = q.id;

UPDATE "NoteAnswer" a
SET "questionType" = 'percent',
    "valueNumber" = CASE WHEN a."valueText" ~ '^\s*\d{1,3}\s*%\s*$' THEN regexp_replace(a."valueText", '\D', '', 'g')::int END,
    "valueText" = NULL
FROM "NoteQuestion" nq
WHERE a."questionId" = nq.id
  AND nq.type = 'percent'
  AND a."questionType" = 'choice'
  AND a."valueText" ~ '^\s*\d{1,3}\s*%\s*$'
  AND (CASE WHEN a."valueText" ~ '^\s*\d{1,3}\s*%\s*$' THEN regexp_replace(a."valueText", '\D', '', 'g')::int END) <= 100;
