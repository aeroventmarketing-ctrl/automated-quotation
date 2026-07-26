/**
 * Roles whose Sales Dashboard is consolidated into My Dashboard — they get a
 * single dashboard, so the standalone Sales Dashboard tab is hidden and its
 * content is embedded inside My Dashboard.
 *
 * Kept in a plain (server-safe) module so both the client nav and the server
 * dashboard pages can import it — values exported from a "use client" module
 * are not usable on the server.
 */
export const DASHBOARD_CONSOLIDATED_ROLES = [
  "plant_manager",
  "prod_head_duct",
  "prod_head_accessories",
  "prod_head_motor",
  "prod_head_fans",
  "purchaser",
  "accounting",
  "warehouse",
  "logistics",
  "quality_inspector_2",
  "technical_head",
] as const;
