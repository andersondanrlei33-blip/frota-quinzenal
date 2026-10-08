-- Separate the previously combined CNPJ/CPF value and normalize their masks.
UPDATE public.fleet_cte_documents AS document
SET participant_details = (
  SELECT COALESCE(
    jsonb_object_agg(
      party.key,
      (party.value - 'document') || jsonb_build_object(
        'cnpj', CASE
          WHEN length(ids.cnpj_digits) = 14 THEN
            substring(ids.cnpj_digits, 1, 2) || '.' ||
            substring(ids.cnpj_digits, 3, 3) || '.' ||
            substring(ids.cnpj_digits, 6, 3) || '/' ||
            substring(ids.cnpj_digits, 9, 4) || '-' ||
            substring(ids.cnpj_digits, 13, 2)
          ELSE COALESCE(party.value->>'cnpj', '')
        END,
        'cpf', CASE
          WHEN length(ids.cpf_digits) = 11 THEN
            substring(ids.cpf_digits, 1, 3) || '.' ||
            substring(ids.cpf_digits, 4, 3) || '.' ||
            substring(ids.cpf_digits, 7, 3) || '-' ||
            substring(ids.cpf_digits, 10, 2)
          ELSE COALESCE(party.value->>'cpf', '')
        END
      ) || CASE
        WHEN length(regexp_replace(COALESCE(party.value->>'document', ''), '[^0-9]', '', 'g')) NOT IN (0, 11, 14)
          THEN jsonb_build_object('document', party.value->'document')
        ELSE '{}'::jsonb
      END
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(COALESCE(document.participant_details, '{}'::jsonb)) AS party(key, value)
  CROSS JOIN LATERAL (
    SELECT
      regexp_replace(
        CASE WHEN length(regexp_replace(COALESCE(party.value->>'document', ''), '[^0-9]', '', 'g')) = 14
          THEN party.value->>'document' ELSE COALESCE(party.value->>'cnpj', '') END,
        '[^0-9]', '', 'g'
      ) AS cnpj_digits,
      regexp_replace(
        CASE WHEN length(regexp_replace(COALESCE(party.value->>'document', ''), '[^0-9]', '', 'g')) = 11
          THEN party.value->>'document' ELSE COALESCE(party.value->>'cpf', '') END,
        '[^0-9]', '', 'g'
      ) AS cpf_digits
  ) AS ids
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each(COALESCE(document.participant_details, '{}'::jsonb)) AS party(key, value)
  WHERE party.value ? 'document'
     OR party.value ? 'cnpj'
     OR party.value ? 'cpf'
);
