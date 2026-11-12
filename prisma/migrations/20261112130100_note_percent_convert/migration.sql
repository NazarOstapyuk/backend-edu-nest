WITH q AS (
  SELECT id FROM "NoteQuestion"
  WHERE type = 'choice'
    AND cardinality(options) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM unnest(options) o
      WHERE o !~ '^\s*\d{1,3}\s*%\s*$'
         OR regexp_replace(o, '\D', '', 'g')::int > 100
    )
)
UPDATE "NoteQuestion" nq
SET type = 'percent',
    options = ARRAY(SELECT (regexp_replace(o, '\D', '', 'g')::int)::text FROM unnest(nq.options) WITH ORDINALITY AS t(o, i) ORDER BY i)
FROM q WHERE nq.id = q.id;

UPDATE "NoteAnswer" a
SET "questionType" = 'percent',
    "valueNumber" = regexp_replace(a."valueText", '\D', '', 'g')::int,
    "valueText" = NULL
FROM "NoteQuestion" nq
WHERE a."questionId" = nq.id
  AND nq.type = 'percent'
  AND a."questionType" = 'choice'
  AND a."valueText" ~ '^\s*\d{1,3}\s*%\s*$'
  AND regexp_replace(a."valueText", '\D', '', 'g')::int <= 100;
