import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

import MarketplaceMascotShippingScene from "@/assets/illustrations/marketplace_mascot_shipping_scene.svg";
import PulseMarketplaceBoost from "@/assets/illustrations/pulse_marketplace_boost.svg";
import Theme from "@/constants/Theme";

export type NetworkLoadsQuickActionId = "give" | "reach";

export type NetworkLoadsQuickAction = {
  id: NetworkLoadsQuickActionId;
  label: string;
  sub: string;
  chip: string;
  illustration: ComponentType<SvgProps>;
  aspect: number;
  accent: string;
  wash: string;
  /** Locked / coming-soon — tap shows notice, no navigation. */
  locked?: boolean;
};

/**
 * Marketplace quick-action cards — Metronic-style SVG illustrations
 * (character art), not Lottie. Supply / growth.
 */
export const NETWORK_LOADS_QUICK_ACTIONS: NetworkLoadsQuickAction[] = [
  {
    id: "give",
    label: "Give loads",
    sub: "Post open freight",
    chip: "Supply",
    illustration: MarketplaceMascotShippingScene,
    aspect: 560 / 262,
    accent: Theme.brandBlueInk,
    wash: "rgba(205, 233, 247, 0.45)",
  },
  {
    id: "reach",
    label: "Pulse Reach",
    sub: "Boost loads, earn credits",
    chip: "Growth",
    illustration: PulseMarketplaceBoost,
    aspect: 480 / 421,
    accent: Theme.accentBrown,
    wash: "rgba(107, 79, 58, 0.08)",
  },
];

export function fitNetworkLoadsIllustration(
  boxW: number,
  boxH: number,
  aspect: number,
): { width: number; height: number } {
  let w = boxW;
  let h = w / aspect;
  if (h > boxH) {
    h = boxH;
    w = h * aspect;
  }
  return { width: w, height: h };
}
