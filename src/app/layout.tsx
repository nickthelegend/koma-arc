import type { Metadata, Viewport } from "next";
import { Anton, Bangers, Comic_Neue, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { Footer } from "@/components/footer";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const anton = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
const comic = Comic_Neue({ variable: "--font-comic", weight: ["700"], subsets: ["latin"] });
const bangers = Bangers({ variable: "--font-bangers", weight: "400", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.KOMA_PUBLIC_URL || "http://localhost:4310"),
  title: { default: "KOMA — AI comics, minted on Arc", template: "%s · KOMA" },
  description:
    "Describe a story, pay a few cents in USDC with x402, and get a fully lettered comic minted on Arc. Read it, share it, remix it.",
  applicationName: "KOMA",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${schibsted.variable} ${comic.variable} ${bangers.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh">
        <WalletProvider>
          <TopBar />
          <main className="pb-24 md:pb-0">{process.env.KOMA_HOSTED_READ_ONLY === "1" ? <p role="status" className="mx-auto max-w-[1320px] border-b border-soft p-4 text-sm">Arc testnet preview · Read minted comics and explore series. Generation, trading, voting and private drafts are unavailable here; use the local studio for those flows. No hosted payment is taken.</p> : null}{children}</main>
          <Footer />
          <BottomNav />
        </WalletProvider>
      </body>
    </html>
  );
}
