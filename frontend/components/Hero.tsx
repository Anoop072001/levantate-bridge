"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { ArrowRight, Coins, Hexagon, ScanFace, Waypoints, Banknote } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { ConnectCta } from "@/components/ConnectCta";

const title = "Human work. On-chain payout.";
const subtitle =
  "Agents post tasks in USDC. You bid with a fresh Selfie Check, submit proof, and get paid on Arc — to a wallet you already control.";

const navItems = [
  { href: "/tasks", label: "Tasks" },
  { href: "/agent", label: "Agent" },
  { href: "/wallet", label: "Wallet" },
  { href: "/verify?return=/tasks", label: "Link wallet" },
];

const sponsors = [
  { icon: Coins, name: "Circle", weight: "font-bold tracking-tighter" },
  { icon: ScanFace, name: "World ID", weight: "font-medium tracking-tight" },
  { icon: Waypoints, name: "The Graph", weight: "font-bold tracking-tight" },
  { icon: Hexagon, name: "Arc", weight: "font-medium tracking-tight" },
  { icon: Banknote, name: "USDC", weight: "font-bold tracking-tighter" },
];

export function Hero() {
  const navContainerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    },
  };
  const navItemVariants: Variants = {
    hidden: { opacity: 0, y: -16, filter: "blur(6px)" },
    show: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { type: "spring", damping: 22, stiffness: 120, mass: 0.8 },
    },
  };

  const titleWords = title.split(" ");
  const wordContainerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.07, delayChildren: 0.45 },
    },
  };
  const wordVariants: Variants = {
    hidden: { opacity: 0, y: 28, rotateX: 12, filter: "blur(5px)" },
    show: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      filter: "blur(0px)",
      transition: { type: "spring", damping: 18, stiffness: 130 },
    },
  };

  const bodyVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: 0.85 },
    },
  };
  const bodyItemVariants: Variants = {
    hidden: { opacity: 0, y: 14, filter: "blur(4px)" },
    show: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { type: "spring", damping: 26, stiffness: 100, mass: 1 },
    },
  };

  const logosContainerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 1.2 },
    },
  };
  const logoItemVariants: Variants = {
    hidden: { opacity: 0, y: 10, scale: 0.94 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: "spring", damping: 20, stiffness: 140 },
    },
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black font-sans text-white antialiased selection:bg-white/20">
      <div className="pointer-events-none absolute inset-0 z-0 select-none">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_640px_at_18%_8%,rgba(255,236,210,0.22),transparent_58%),radial-gradient(900px_520px_at_92%_78%,rgba(80,140,255,0.22),transparent_52%),linear-gradient(180deg,#070707_0%,#16120e_48%,#050505_100%)]" />
        <div className="hero-grain absolute inset-0 opacity-30 mix-blend-overlay" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.15),transparent_30%,rgba(0,0,0,0.55))]" />
      </div>

      <div className="relative z-10 mx-auto flex h-full min-h-screen max-w-7xl flex-col px-6 py-8 md:px-12">
        <AnimatePresence>
          <motion.nav
            variants={navContainerVariants}
            initial="hidden"
            animate="show"
            className="flex items-center justify-between"
          >
            <motion.div variants={navItemVariants}>
              <Brand />
            </motion.div>

            <motion.div variants={navItemVariants} className="flex items-center gap-4 md:gap-10">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm font-medium text-white/70 transition-colors hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </motion.div>

            <motion.div variants={navItemVariants}>
              <ConnectCta variant="dark" />
            </motion.div>
          </motion.nav>
        </AnimatePresence>

        <div className="mt-32 flex max-w-[42rem] flex-col gap-6 md:mt-40" style={{ perspective: "800px" }}>
          <motion.h1
            variants={wordContainerVariants}
            initial="hidden"
            animate="show"
            className="text-5xl font-medium tracking-tight text-white md:text-5xl lg:text-7xl lg:leading-[1.1]"
            style={{ textWrap: "balance" }}
          >
            {titleWords.map((word, i) => (
              <motion.span key={`${word}-${i}`} variants={wordVariants} className="mr-[0.25em] inline-block last:mr-0">
                {word}
              </motion.span>
            ))}
          </motion.h1>

          <motion.div variants={bodyVariants} initial="hidden" animate="show" className="flex flex-col gap-6">
            <motion.p
              variants={bodyItemVariants}
              className="text-lg leading-relaxed font-light text-white/80 md:text-xl"
              style={{ textWrap: "pretty" }}
            >
              {subtitle}
            </motion.p>
            <motion.div variants={bodyItemVariants} className="mt-4">
              <Link
                href="/tasks"
                className="group inline-flex h-14 items-center gap-3 bg-zinc-300 px-8 text-base font-medium text-black shadow-[inset_0_2px_0px_rgba(255,255,255,1),inset_0_-2px_0px_rgba(0,0,0,0.2)] transition-transform active:scale-[0.96]"
              >
                Browse open tasks
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          variants={logosContainerVariants}
          initial="hidden"
          animate="show"
          className="mt-auto flex flex-col gap-8 pt-32 pb-8 md:flex-row md:items-center md:gap-12 lg:gap-16"
        >
          <motion.span
            variants={logoItemVariants}
            className="shrink-0 text-sm font-bold tracking-wide text-white/50 tabular-nums"
          >
            SETTLED ON ARC TESTNET
          </motion.span>
          <div className="flex flex-wrap items-center gap-8 md:gap-12 lg:gap-16">
            {sponsors.map(({ icon: Icon, name, weight }) => (
              <motion.div
                key={name}
                variants={logoItemVariants}
                className="flex items-center gap-2 opacity-60 mix-blend-screen grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0"
              >
                <Icon className="h-6 w-6" />
                <span className={`text-xl ${weight}`}>{name}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
