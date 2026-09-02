-- ── Is the rating power stored in kW, or was a BHP column loaded straight in? ──
--
--   air power a fan delivers = (m³/hr ÷ 3600) × Pa          [watts]
--   fan static efficiency    = air power ÷ absorbed power
--
-- If `power_kw` is actually holding BHP, every absorbed figure is
-- 1 ÷ 0.7457 = 1.34× too big, so every efficiency reads 0.7457× too small.
--
-- Read the two efficiency columns side by side and pick the believable one:
-- a backward-inclined (CEB) wheel peaks around 0.70–0.80, a forward-curve
-- (CFAB) wheel lower. If "as_stored" looks too low and "if_bhp_was_copied"
-- looks right, that model's power column was never converted.
SELECT ci."modelCode",
       count(*) AS rating_rows,
       round(max(rp."airflow_m3hr" / 3600.0 * rp."staticPressure_pa"
                 / (rp."power_kw" * 1000.0))::numeric, 3)           AS peak_eff_as_stored,
       round(max(rp."airflow_m3hr" / 3600.0 * rp."staticPressure_pa"
                 / (rp."power_kw" * 1000.0))::numeric / 0.7457, 3)  AS peak_eff_if_bhp_was_copied,
       CASE WHEN max(rp."airflow_m3hr" / 3600.0 * rp."staticPressure_pa"
                     / (rp."power_kw" * 1000.0)) > 1.0
            THEN 'IMPOSSIBLE — more air power out than shaft power in'
            ELSE '' END                                             AS flag
FROM "FanRatingPoint" rp
JOIN "CatalogueItem" ci ON ci.id = rp."catalogueItemId"
WHERE rp."power_kw" > 0 AND rp."airflow_m3hr" > 0 AND rp."staticPressure_pa" > 0
GROUP BY ci."modelCode"
ORDER BY peak_eff_as_stored;


-- ── 2. Duplicated rating rows ────────────────────────────────────────────────
-- An import run twice leaves every (rpm, airflow, SP) twice. It does not change
-- the efficiency check above — the same numbers are simply there twice — so
-- nothing else would notice.
SELECT ci."modelCode",
       count(*)                                                              AS rating_rows,
       count(DISTINCT (rp.rpm, rp."airflow_m3hr", rp."staticPressure_pa"))    AS distinct_points,
       count(*) - count(DISTINCT (rp.rpm, rp."airflow_m3hr", rp."staticPressure_pa")) AS duplicates
FROM "FanRatingPoint" rp
JOIN "CatalogueItem" ci ON ci.id = rp."catalogueItemId"
GROUP BY ci."modelCode"
HAVING count(*) > count(DISTINCT (rp.rpm, rp."airflow_m3hr", rp."staticPressure_pa"))
ORDER BY duplicates DESC;


-- ── 3. Inspect one model against its printed sheet ───────────────────────────
-- For a model the checks above flag: put its rows next to the catalogue page.
-- `bhp` is what the selector will quote from; compare it with the printed BHP
-- for that CFM / SP cell.
SELECT round(rp."airflow_m3hr"::numeric / 1.699, 0)      AS cfm,
       round(rp."staticPressure_pa"::numeric / 249.09, 3) AS sp_inwg,
       rp.rpm,
       round(rp."power_kw"::numeric, 3)                   AS power_kw,
       round((rp."power_kw" / 0.7457)::numeric, 2)        AS bhp,
       round((rp."airflow_m3hr" / 3600.0 * rp."staticPressure_pa"
              / (rp."power_kw" * 1000.0))::numeric, 3)    AS efficiency
FROM "FanRatingPoint" rp
JOIN "CatalogueItem" ci ON ci.id = rp."catalogueItemId"
WHERE ci."modelCode" = 'AV3650DIDWCFAB'   -- ← change this
ORDER BY sp_inwg, cfm
LIMIT 40;
