import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

import Illustration4 from "@/assets/illustrations/4.svg";
import Illustration12 from "@/assets/illustrations/12.svg";
import Illustration20 from "@/assets/illustrations/20.svg";
import PulseMarketplaceBoost from "@/assets/illustrations/pulse_marketplace_boost.svg";
import Theme from "@/constants/Theme";

export type NetworkLoadsQuickActionId = "give" | "get" | "reach" | "assist";

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
 * (character art), not Lottie. Supply / demand / growth / locked assist.
 */
export const NETWORK_LOADS_QUICK_ACTIONS: NetworkLoadsQuickAction[] = [
  {
    id: "give",
    label: "Give loads",
    sub: "Post open freight",
    chip: "Supply",
    illustration: Illustration4,
    aspect: 600 / 463,
    accent: Theme.brandBlueInk,
    wash: "rgba(205, 233, 247, 0.45)",
  },
  {
    id: "get",
    label: "Get loads",
    sub: "Bid on freight",
    chip: "Demand",
    illustration: Illustration20,
    aspect: 600 / 480,
    accent: "#059669",
    wash: "rgba(16, 185, 129, 0.08)",
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
  {
    id: "assist",
    label: "Pulse Assist",
    sub: "100% guaranteed",
    chip: "Assist",
    illustration: Illustration12,
    aspect: 600 / 520,
    accent: Theme.textMuted,
    wash: "rgba(148, 163, 184, 0.14)",
    locked: true,
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
