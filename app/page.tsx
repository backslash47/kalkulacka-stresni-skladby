import type { Metadata } from "next";
import RoofCalculator from "./roof-calculator";

export const metadata: Metadata = {
  title: "Kalkulačka střešní skladby",
  description: "Teplotní a difuzní posouzení střešní konstrukce.",
};

export default function Home() {
  return <RoofCalculator />;
}
