/**
 * Stand-in artwork for a product with no photo yet — a fan rotor (or a scroll
 * housing for centrifugal blowers) drawn in CSS, so an unphotographed item
 * still reads as equipment rather than an empty grey box. Shared by the product
 * card and the product page's gallery so both show the same thing.
 */
export function FanPlaceholder({ blower = false, scale = 1 }: { blower?: boolean; scale?: number }) {
  return (
    <div
      aria-hidden
      className="relative"
      style={{
        width: (blower ? 150 : 128) * scale,
        height: (blower ? 125 : 128) * scale,
        border: `${22 * scale}px solid #aeb8c2`,
        borderRadius: blower ? `${10 * scale}px ${70 * scale}px ${70 * scale}px ${10 * scale}px` : "50%",
        boxShadow: `inset 0 0 0 ${12 * scale}px #e9edf0, 0 12px 25px rgba(84,98,112,0.17)`,
      }}
    >
      <span
        className="absolute rounded-full"
        style={{
          inset: 20 * scale,
          background:
            "conic-gradient(from 15deg,#536272 0 15%,transparent 15% 25%,#536272 25% 40%,transparent 40% 50%,#536272 50% 65%,transparent 65% 75%,#536272 75% 90%,transparent 90%)",
        }}
      />
      {blower && (
        <span
          className="absolute"
          style={{
            width: 50 * scale,
            height: 50 * scale,
            right: -38 * scale,
            top: 37 * scale,
            background: "#9eabb7",
            borderRadius: `0 ${5 * scale}px ${5 * scale}px 0`,
          }}
        />
      )}
    </div>
  );
}

/** True when a category label describes a centrifugal blower (scroll housing). */
export const isBlowerCategory = (category: string): boolean => category.toLowerCase().includes("centrifugal");
