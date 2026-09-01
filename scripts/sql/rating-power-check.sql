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
