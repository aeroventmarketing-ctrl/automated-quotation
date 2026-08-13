import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { verifyUnsubscribe } from "@/lib/marketing-unsubscribe";
import { confirmUnsubscribe } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Public one-click unsubscribe landing. Validates the HMAC token from the email
 * link, then asks the recipient to confirm (a POST — so link prefetching can't
 * silently opt anyone out). On confirm, {@link confirmUnsubscribe} sets the
 * client's opt-out flag.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; t?: string; done?: string; error?: string }>;
}) {
  const { c = "", t = "", done, error } = await searchParams;
  const valid = verifyUnsubscribe(c, t);

  const customer = valid ? await prisma.customer.findUnique({ where: { id: c }, select: { company: true, email: true } }).catch(() => null) : null;
  const who = customer?.email || customer?.company || "your address";

  const shell = (title: string, body: React.ReactNode) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#eef2f6", fontFamily: "Arial, Helvetica, sans-serif", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: 480, background: "#fff", borderRadius: 12, padding: "28px 28px 24px", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
        <div style={{ color: "#0b5c8f", fontWeight: 700, fontSize: 15 }}>{COMPANY.name}</div>
        <div style={{ color: "#607080", fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", marginTop: 2 }}>{COMPANY.tagline}</div>
        <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "16px 0" }} />
        <h1 style={{ fontSize: 18, margin: "0 0 10px", color: "#1f2933" }}>{title}</h1>
        {body}
      </div>
    </div>
  );

  if (!valid) {
    return shell("Link not valid", <p style={{ color: "#607080", fontSize: 14, lineHeight: 1.6 }}>This unsubscribe link is invalid or has expired. If you&rsquo;d like to stop receiving our emails, simply reply to any of our messages and we&rsquo;ll remove you.</p>);
  }
  if (error) {
    return shell("Something went wrong", <p style={{ color: "#607080", fontSize: 14, lineHeight: 1.6 }}>We couldn&rsquo;t process that request. Please try the link again, or reply to any of our emails to opt out.</p>);
  }
  if (done) {
    return shell("You&rsquo;ve been unsubscribed", <p style={{ color: "#1f2933", fontSize: 14, lineHeight: 1.6 }}>{who} has been removed from our marketing list. You won&rsquo;t receive further promotional emails from us. Thank you.</p>);
  }

  return shell(
    "Unsubscribe from marketing emails",
    <form action={confirmUnsubscribe}>
      <input type="hidden" name="c" value={c} />
      <input type="hidden" name="t" value={t} />
      <p style={{ color: "#607080", fontSize: 14, lineHeight: 1.6, margin: "0 0 18px" }}>
        Click below to stop receiving marketing emails at <strong style={{ color: "#1f2933" }}>{who}</strong>. You&rsquo;ll still receive any messages directly related to your orders or quotations.
      </p>
      <button type="submit" style={{ display: "inline-block", background: "#0b5c8f", color: "#fff", border: "none", borderRadius: 6, padding: "11px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
        Unsubscribe
      </button>
    </form>,
  );
}
