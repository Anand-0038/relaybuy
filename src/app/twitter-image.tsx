import { renderSocialCard, socialImageSize } from "./social-card";

export const alt = "RelayBuy proof before purchase for AI agents";
export const size = socialImageSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderSocialCard();
}
