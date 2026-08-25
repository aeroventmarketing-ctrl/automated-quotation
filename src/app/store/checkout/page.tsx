import type { Metadata } from "next";
import { CheckoutView } from "./checkout-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Checkout — Aerovent Fans & Blowers" };

export default function CheckoutPage() {
  return <CheckoutView />;
}
