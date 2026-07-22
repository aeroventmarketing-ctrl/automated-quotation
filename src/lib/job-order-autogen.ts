/**
 * Auto-generate production job orders from a paid quotation's line items. When an
 * order's payment is cleared it moves to "For JO creation"; instead of the
 * engineer building each job order by hand, we pre-populate them from the
 * quotation lines so they only need to review, set the due date, edit and approve.
 *
 * Phase 1 covers the two cleanly-mappable departments — Motor Controller and
 * Accessories (incl. spring vibration isolators). Fans & Blowers and Duct are
 * table-driven and are populated in a later phase; the engineer still adds those
 * manually for now.
 */
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder, type AccessoryLine } from "@/lib/accessories-job-order";
import { coerceMotorControllerJobOrder, type MotorControllerJobOrder, type MotorControllerLine } from "@/lib/motor-controller-job-order";

/** The subset of a quotation item the generator reads. */
export interface QuoteItemLike {
  qty: number;
  descriptionSnapshot: string;
  specsSnapshot: unknown;
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

function specsOf(it: QuoteItemLike): Record<string, unknown> {
  return (it.specsSnapshot && typeof it.specsSnapshot === "object" ? it.specsSnapshot : {}) as Record<string, unknown>;
}

const isMotorController = (s: Record<string, unknown>) => s.type === "Motor Controller";
const isIsolator = (s: Record<string, unknown>) => s.type === "Spring Vibration Isolator";
const isAccessory = (s: Record<string, unknown>) => s.category === "Ventilation Accessories" || isIsolator(s);

export interface AutoJobOrders {
  accessories: AccessoriesJobOrder[];
  motor: MotorControllerJobOrder[];
}

/**
 * Build the auto-populated job orders for the mappable departments. Returns one
 * job order per department (with a line per matching quotation item), or an empty
 * list for a department with no matching lines. Job numbers are left blank — they
 * are claimed from the running counter and formatted (with the a/b/c suffix) when
 * the workflow is saved / rendered, exactly like a manually-added job order.
 */
export function buildAutoJobOrders(items: QuoteItemLike[], opts: { project: string; date: string }): AutoJobOrders {
  const motorLines: MotorControllerLine[] = [];
  const accessoryLines: AccessoryLine[] = [];

  for (const it of items) {
    const s = specsOf(it);
    const qty = it.qty > 0 ? String(it.qty) : "1";
    if (isMotorController(s)) {
      motorLines.push({
        quantity: qty,
        uom: "pc",
        starterType: str(s.starterType),
        hp: str(s.motorHp),
        phase: str(s.motorPh) || "3",
        voltage: str(s.motorVolts),
      });
    } else if (isAccessory(s)) {
      accessoryLines.push({
        type: str(s.type),
        quantity: qty,
        uom: "pc",
        // Dimensions live in the description; the engineer fills the labelled
        // fields. Carry the description into the per-line note for context.
        dimensions: [],
        material: str(s.material),
        note: str(it.descriptionSnapshot),
      });
    }
  }

  const header = { date: opts.date, project: opts.project, dueDate: "", note: "", assignedPersonnel: "" };
  const motor: MotorControllerJobOrder[] = motorLines.length
    ? [{ ...(coerceMotorControllerJobOrder({}) as MotorControllerJobOrder), ...header, lines: motorLines }]
    : [];
  const accessories: AccessoriesJobOrder[] = accessoryLines.length
    ? [{ ...(coerceAccessoriesJobOrder({}) as AccessoriesJobOrder), ...header, lines: accessoryLines }]
    : [];

  return { accessories, motor };
}
