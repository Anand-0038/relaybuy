import { renderSocialCard, socialImageSize } from "./social-card";

export const alt = "RelayBuy evidence-gated purchasing";
export const size = socialImageSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderSocialCard();
}
