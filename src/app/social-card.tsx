import { ImageResponse } from "next/og";

export const socialImageSize = {
  width: 1200,
  height: 630,
};

export function renderSocialCard(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#f7f6f1",
        color: "#111816",
        display: "flex",
        fontFamily: "sans-serif",
        height: "100%",
        padding: "72px",
        width: "100%",
      }}
    >
      <div
        style={{
          border: "2px solid #dce4e0",
          borderRadius: "36px",
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "54px",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "18px" }}>
          <div
            style={{
              alignItems: "center",
              background: "#0d8b80",
              borderRadius: "18px 18px 18px 6px",
              color: "white",
              display: "flex",
              fontSize: "38px",
              fontWeight: 800,
              height: "72px",
              justifyContent: "center",
              width: "72px",
            }}
          >
            R
          </div>
          <div style={{ display: "flex", fontSize: "42px", fontWeight: 800 }}>
            RelayBuy
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "22px",
            maxWidth: "920px",
          }}
        >
          <div
            style={{
              color: "#0a6d65",
              display: "flex",
              fontSize: "24px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Proof before purchase for AI agents
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "68px",
              fontWeight: 760,
              letterSpacing: "-0.05em",
              lineHeight: 1,
            }}
          >
            Agents can suggest. Spending requires proof.
          </div>
        </div>
        <div style={{ color: "#60706a", display: "flex", fontSize: "24px" }}>
          The model extracts → code decides → humans approve → Prava authorizes
        </div>
      </div>
    </div>,
    socialImageSize,
  );
}
