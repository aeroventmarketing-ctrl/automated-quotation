/**
 * The default motor brand used when auto-generating Fans & Blowers job orders.
 * The brand changes with product availability, so it's an admin-set default
 * (not per-quotation): flip it once and every newly auto-generated Fans JO uses
 * it. Engineers can still override the brand on any individual job order.
 * Stored in the AppSetting key/value table (no migration).
 */
import { prisma } from "@/lib/db";

export const FAN_MOTOR_BRAND_KEY = "fan_motor_brand_default";
export const FAN_MOTOR_BRANDS = ["TECO", "Hyundai"] as const;
export type FanMotorBrand = (typeof FAN_MOTOR_BRANDS)[number];

export function coerceFanMotorBrand(v: unknown): FanMotorBrand {
  return v === "Hyundai" ? "Hyundai" : "TECO";
}

/** The admin-set default motor brand (TECO if never configured). */
export async function getFanMotorBrand(): Promise<FanMotorBrand> {
  const row = await prisma.appSetting.findUnique({ where: { key: FAN_MOTOR_BRAND_KEY } });
  return coerceFanMotorBrand((row?.value as { brand?: unknown } | null)?.brand);
}

/** Set the default motor brand used for Fans JO auto-generation. */
export async function setFanMotorBrand(brand: string): Promise<FanMotorBrand> {
  const clean = coerceFanMotorBrand(brand);
  await prisma.appSetting.upsert({
    where: { key: FAN_MOTOR_BRAND_KEY },
    create: { key: FAN_MOTOR_BRAND_KEY, value: { brand: clean } },
    update: { value: { brand: clean } },
  });
  return clean;
}
