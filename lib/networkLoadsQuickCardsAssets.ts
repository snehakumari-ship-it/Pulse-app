import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

import PulseExchangeTruck from "@/assets/illustrations/pulse_exchange_truck.svg";
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
 * (character art), not Lottie. Exchange / growth.
 */
export const NETWORK_LOADS_QUICK_ACTIONS: NetworkLoadsQuickAction[] = [
  {
    id: "give",
    label: "Pulse Exchange",
    sub: "Post loads, win live bids",
    chip: "Exchange",
    illustration: PulseExchangeTruck,
    aspect: 480 / 282,
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
