import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your cart — Aerovent Fans & Blowers" };

export default function CartPage() {
  return <CartView />;
}
