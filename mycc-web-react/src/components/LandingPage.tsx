import { useRef } from "react";
import {
  ArrowRightIcon,
  BellAlertIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const assetBase = "/landing";

const frames = [
  {
    label: "调研",
    title: "网页调研与结论报告",
    caption: "读网页，留来源。",
    command: "帮我调研竞品动态",
    status: "道友正在读网页",
    output: "结论报告",
    image: `${assetBase}/scene-web-research.jpg`,
    alt: "道友 AI 网页调研场景",
    Icon: MagnifyingGlassIcon,
  },
  {
    label: "整理",
    title: "资料整理与成果包",
    caption: "文件归位，线索成形。",
    command: "把桌面资料归档",
    status: "道友正在归类",
    output: "项目索引",
    image: `${assetBase}/scene-file-organize.jpg`,
    alt: "道友 AI 资料整理场景",
    Icon: FolderOpenIcon,
  },
  {
    label: "生成",
    title: "周报与汇报文档",
    caption: "结果成稿，口径清楚。",
    command: "写成本周汇报",
    status: "道友正在成稿",
    output: "周报初稿",
    image: `${assetBase}/scene-weekly-report.jpg`,
    alt: "道友 AI 周报生成场景",
    Icon: DocumentTextIcon,
  },
  {
    label: "跟进",
    title: "会议后续与自动跟进",
    caption: "到时间，继续推进。",
    command: "周五提醒我跟进",
    status: "道友正在排程",
    output: "提醒待办",
    image: `${assetBase}/scene-follow-up.jpg`,
    alt: "道友 AI 自动跟进场景",
    Icon: BellAlertIcon,
  },
];

export function LandingPage() {
  const landingRef = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          isDesktop: "(min-width: 981px)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const { isDesktop, reduceMotion } = context.conditions as {
            isDesktop: boolean;
            reduceMotion: boolean;
          };

          if (reduceMotion) {
            gsap.set(
              ".dy-hero-motion, .dy-orbit-frame, .dy-hyper-card, .dy-final-motion, .dy-daoyou-ui",
              {
                autoAlpha: 1,
                clearProps: "transform,visibility,opacity",
              },
            );
            return;
          }

          gsap
            .timeline({ defaults: { ease: "power3.out", duration: 0.9 } })
            .from(".dy-header", { autoAlpha: 0, y: -16, duration: 0.5 })
            .from(
              ".dy-hero-motion",
              { autoAlpha: 0, y: 44, stagger: 0.08 },
              "-=0.1",
            )
            .from(
              ".dy-orbit-frame",
              {
                autoAlpha: 0,
                y: 58,
                rotation: (index) => [-7, 5, -3, 7][index] ?? 0,
                scale: 0.92,
                stagger: 0.1,
                duration: 1,
              },
              "-=0.48",
            )
            .from(
              ".dy-orbit-chip",
              { autoAlpha: 0, y: 18, stagger: 0.06, duration: 0.55 },
              "-=0.4",
            )
            .from(
              ".dy-daoyou-ui",
              { autoAlpha: 0, y: 18, stagger: 0.06, duration: 0.58 },
              "-=0.46",
            );

          gsap.to(".dy-orbit-frame", {
            y: (index) => [-18, 22, -12, 16][index] ?? 0,
            rotation: (index) => [-2, 1.8, -1.4, 2.2][index] ?? 0,
            duration: 3.2,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            stagger: { each: 0.18, from: "center" },
          });

          gsap.to(".dy-orbit-media img", {
            scale: 1.08,
            duration: 5,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            stagger: 0.25,
          });

          gsap.to(".dy-lane-node", {
            x: 14,
            scale: 1.08,
            duration: 1.1,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            stagger: 0.12,
          });

          if (isDesktop) {
            const cards = gsap.utils.toArray<HTMLElement>(".dy-hyper-card");
            const labels = gsap.utils.toArray<HTMLElement>(".dy-hyper-label");

            gsap.set(cards, {
              autoAlpha: 0,
              yPercent: 22,
              scale: 0.86,
              rotation: (index) => [-7, 6, -4, 5][index] ?? 0,
              transformOrigin: "50% 58%",
            });
            gsap.set(cards[0], {
              autoAlpha: 1,
              yPercent: 0,
              scale: 1,
              rotation: 0,
            });
            gsap.set(labels, { autoAlpha: 0.34 });
            gsap.set(labels[0], { autoAlpha: 1 });

            const hyperTl = gsap.timeline({
              scrollTrigger: {
                trigger: ".dy-hyper",
                start: "top top",
                end: () => `+=${window.innerHeight * (cards.length + 0.75)}`,
                pin: ".dy-hyper-pin",
                scrub: 1,
                invalidateOnRefresh: true,
                refreshPriority: 1,
              },
            });

            cards.forEach((card, index) => {
              if (index === 0) return;
              const previous = cards[index - 1];
              const label = labels[index];
              const previousLabel = labels[index - 1];

              hyperTl
                .to(previous, {
                  autoAlpha: 0.25,
                  yPercent: -18,
                  scale: 0.78,
                  rotation: [-8, 7, -6, 6][index - 1] ?? -5,
                  duration: 0.75,
                  ease: "none",
                })
                .to(
                  card,
                  {
                    autoAlpha: 1,
                    yPercent: 0,
                    scale: 1,
                    rotation: 0,
                    duration: 0.75,
                    ease: "none",
                  },
                  "<",
                )
                .to(
                  previousLabel,
                  { autoAlpha: 0.34, duration: 0.35, ease: "none" },
                  "<",
                )
                .to(label, { autoAlpha: 1, duration: 0.35, ease: "none" }, "<");
            });

            gsap.to(".dy-hyper-glass", {
              xPercent: 18,
              yPercent: -10,
              scale: 1.08,
              ease: "none",
              scrollTrigger: {
                trigger: ".dy-hyper",
                start: "top bottom",
                end: "bottom top",
                scrub: 1,
                refreshPriority: 0,
              },
            });
          } else {
            gsap.set(".dy-hyper-card", { autoAlpha: 1 });
          }

          ScrollTrigger.batch(".dy-final-motion", {
            start: "top 82%",
            once: true,
            onEnter: (elements) => {
              gsap.from(elements, {
                autoAlpha: 0,
                y: 34,
                stagger: 0.08,
                duration: 0.76,
                ease: "power3.out",
              });
            },
          });

          requestAnimationFrame(() => ScrollTrigger.refresh());
        },
      );

      return () => mm.revert();
    },
    { scope: landingRef },
  );

  return (
    <main className="dy-landing" ref={landingRef}>
      <style>{`
        .dy-landing {
          --dy-bg: #080b0a;
          --dy-bg-2: #101713;
          --dy-text: #f4f8f2;
          --dy-muted: rgba(244, 248, 242, 0.64);
          --dy-line: rgba(232, 245, 235, 0.15);
          --dy-line-strong: rgba(232, 245, 235, 0.24);
          --dy-accent: #7ee0a4;
          --dy-accent-2: #d6ff73;
          --dy-ink: #101713;
          min-height: 100dvh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 64% 8%, rgba(126, 224, 164, 0.16), transparent 360px),
            linear-gradient(180deg, #111813 0%, var(--dy-bg) 56%);
          color: var(--dy-text);
          font-family:
            ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "PingFang SC", "Microsoft YaHei", sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .dy-landing *,
        .dy-landing *::before,
        .dy-landing *::after {
          box-sizing: border-box;
        }

        .dy-landing a {
          color: inherit;
          text-decoration: none;
        }

        .dy-header {
          position: fixed;
          inset: 0 0 auto;
          z-index: 30;
          height: 68px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(8, 11, 10, 0.76);
          backdrop-filter: blur(18px);
        }

        .dy-header-inner,
        .dy-wide {
          width: min(1240px, calc(100% - 48px));
          margin: 0 auto;
        }

        .dy-header-inner {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .dy-brand,
        .dy-nav,
        .dy-actions,
        .dy-chipline,
        .dy-frame-meta,
        .dy-hyper-label,
        .dy-shot-tag,
        .dy-daoyou-top,
        .dy-daoyou-prompt,
        .dy-artifact-tray {
          display: flex;
          align-items: center;
        }

        .dy-brand {
          gap: 12px;
          font-size: 18px;
          font-weight: 850;
          white-space: nowrap;
        }

        .dy-brand-mark,
        .dy-cta-icon,
        .dy-shot-icon {
          display: grid;
          place-items: center;
          flex: none;
        }

        .dy-brand-mark {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent 38%),
            linear-gradient(135deg, #1d3429, #7ee0a4);
          box-shadow: 0 16px 38px rgba(66, 190, 116, 0.2);
          font-size: 18px;
          font-weight: 900;
        }

        .dy-nav {
          gap: 24px;
          color: rgba(244, 248, 242, 0.62);
          font-size: 14px;
          font-weight: 650;
          white-space: nowrap;
        }

        .dy-actions {
          gap: 14px;
          color: rgba(244, 248, 242, 0.74);
          font-size: 14px;
          font-weight: 760;
          white-space: nowrap;
        }

        .dy-header-button {
          border-radius: 999px;
          background: var(--dy-text);
          color: var(--dy-ink);
          padding: 9px 16px;
          font-weight: 850;
        }

        .dy-hero {
          position: relative;
          min-height: 100dvh;
          overflow: hidden;
          padding: 104px 24px 54px;
        }

        .dy-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px);
          background-size: 58px 58px;
          mask-image: linear-gradient(to bottom, black, transparent 78%);
          pointer-events: none;
        }

        .dy-hero-layout {
          position: relative;
          z-index: 1;
          width: min(1240px, calc(100vw - 48px));
          min-height: calc(100dvh - 158px);
          margin: 0 auto;
          display: grid;
          grid-template-columns: 0.72fr 1.28fr;
          align-items: center;
          gap: clamp(28px, 5vw, 70px);
        }

        .dy-hero h1 {
          max-width: 610px;
          margin: 0;
          font-size: clamp(62px, 8.2vw, 112px);
          line-height: 0.92;
          letter-spacing: 0;
          font-weight: 920;
        }

        .dy-title-soft {
          display: block;
          color: rgba(244, 248, 242, 0.58);
        }

        .dy-hero-copy p {
          max-width: 430px;
          margin: 24px 0 0;
          color: var(--dy-muted);
          font-size: clamp(17px, 1.7vw, 21px);
          line-height: 1.55;
        }

        .dy-cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 30px;
        }

        .dy-cta {
          min-height: 56px;
          display: inline-flex;
          align-items: center;
          gap: 11px;
          border-radius: 16px;
          padding: 11px 15px;
          transition:
            transform 180ms ease,
            background 180ms ease,
            border-color 180ms ease;
        }

        .dy-cta:hover {
          transform: translateY(-2px);
        }

        .dy-cta:active {
          transform: translateY(0);
        }

        .dy-cta-primary {
          background: var(--dy-text);
          color: var(--dy-ink);
          box-shadow: 0 22px 52px rgba(0, 0, 0, 0.3);
        }

        .dy-cta-secondary {
          border: 1px solid var(--dy-line);
          background: rgba(255, 255, 255, 0.07);
          color: var(--dy-text);
        }

        .dy-cta-icon {
          width: 30px;
          height: 30px;
          border-radius: 9px;
          background: var(--dy-ink);
          color: var(--dy-text);
          font-size: 13px;
          font-weight: 900;
        }

        .dy-cta-secondary .dy-cta-icon {
          background: var(--dy-text);
          color: var(--dy-ink);
        }

        .dy-cta-title,
        .dy-cta-desc {
          display: block;
        }

        .dy-cta-title {
          font-size: 15px;
          font-weight: 850;
          line-height: 1.1;
        }

        .dy-cta-desc {
          margin-top: 4px;
          color: #637064;
          font-size: 12px;
          font-weight: 680;
        }

        .dy-cta-secondary .dy-cta-desc {
          color: rgba(244, 248, 242, 0.54);
        }

        .dy-orbit {
          position: relative;
          min-height: 650px;
          perspective: 1400px;
        }

        .dy-orbit::before {
          content: "";
          position: absolute;
          inset: 9% 4% 7% 12%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 38px;
          transform: rotate(-3deg);
          background:
            radial-gradient(circle at 18% 18%, rgba(126, 224, 164, 0.18), transparent 240px),
            rgba(255, 255, 255, 0.035);
        }

        .dy-orbit-frame,
        .dy-hyper-card,
        .dy-hero-motion,
        .dy-orbit-media img,
        .dy-hyper-glass,
        .dy-final-motion,
        .dy-daoyou-ui,
        .dy-lane-node {
          will-change: transform, opacity;
        }

        .dy-orbit-frame {
          position: absolute;
          border: 1px solid var(--dy-line-strong);
          border-radius: 28px;
          overflow: hidden;
          background: #111813;
          box-shadow:
            0 34px 100px rgba(0, 0, 0, 0.34),
            inset 0 1px rgba(255, 255, 255, 0.16);
        }

        .dy-orbit-frame:nth-child(1) {
          left: 2%;
          top: 13%;
          width: 52%;
          aspect-ratio: 4 / 3;
          transform: rotate(-5deg);
          z-index: 4;
        }

        .dy-orbit-frame:nth-child(2) {
          right: 2%;
          top: 2%;
          width: 58%;
          aspect-ratio: 16 / 10;
          transform: rotate(4deg);
          z-index: 3;
        }

        .dy-orbit-frame:nth-child(3) {
          left: 21%;
          bottom: 0;
          width: 57%;
          aspect-ratio: 16 / 10;
          transform: rotate(-2deg);
          z-index: 5;
        }

        .dy-orbit-frame:nth-child(4) {
          right: 0;
          bottom: 10%;
          width: 38%;
          aspect-ratio: 4 / 3;
          transform: rotate(6deg);
          z-index: 2;
        }

        .dy-orbit-media,
        .dy-hyper-media {
          position: absolute;
          inset: 0;
        }

        .dy-orbit-media::after,
        .dy-hyper-media::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, transparent 44%, rgba(8, 11, 10, 0.74)),
            linear-gradient(90deg, rgba(8, 11, 10, 0.3), transparent 58%);
        }

        .dy-orbit-media img,
        .dy-hyper-media img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
        }

        .dy-shot-tag {
          position: absolute;
          left: 16px;
          bottom: 16px;
          z-index: 1;
          gap: 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 999px;
          background: rgba(8, 11, 10, 0.64);
          backdrop-filter: blur(14px);
          padding: 8px 11px;
          color: var(--dy-text);
          font-size: 13px;
          font-weight: 780;
        }

        .dy-shot-icon {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: rgba(126, 224, 164, 0.16);
          color: var(--dy-accent);
        }

        .dy-shot-icon svg {
          width: 16px;
          height: 16px;
        }

        .dy-orbit-command {
          position: absolute;
          left: 6%;
          top: 7%;
          z-index: 7;
          width: min(390px, 58%);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 22px;
          background: rgba(8, 11, 10, 0.72);
          backdrop-filter: blur(18px);
          padding: 14px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
        }

        .dy-orbit-command span {
          display: block;
          color: rgba(244, 248, 242, 0.48);
          font-size: 12px;
          font-weight: 780;
        }

        .dy-orbit-command strong {
          display: block;
          margin-top: 6px;
          color: var(--dy-text);
          font-size: clamp(18px, 2vw, 24px);
          line-height: 1.25;
          font-weight: 880;
        }

        .dy-orbit-output {
          position: absolute;
          right: 5%;
          top: 44%;
          z-index: 7;
          width: 168px;
          border: 1px solid rgba(126, 224, 164, 0.28);
          border-radius: 20px;
          background: rgba(231, 247, 228, 0.94);
          color: #132018;
          padding: 14px;
          box-shadow: 0 26px 80px rgba(0, 0, 0, 0.22);
        }

        .dy-orbit-output span {
          display: block;
          color: #647467;
          font-size: 11px;
          font-weight: 850;
        }

        .dy-orbit-output strong {
          display: block;
          margin-top: 7px;
          font-size: 18px;
          line-height: 1.16;
          font-weight: 900;
        }

        .dy-chipline {
          position: absolute;
          left: 4%;
          right: 4%;
          bottom: 4%;
          z-index: 6;
          justify-content: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .dy-orbit-chip {
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(14px);
          padding: 8px 11px;
          color: rgba(244, 248, 242, 0.76);
          font-size: 12px;
          font-weight: 760;
        }

        .dy-hyper {
          position: relative;
          background: var(--dy-bg);
        }

        .dy-hyper-pin {
          position: relative;
          min-height: 100dvh;
          overflow: hidden;
          display: grid;
          place-items: center;
          padding: 92px 24px 64px;
        }

        .dy-hyper-glass {
          position: absolute;
          width: min(620px, 58vw);
          height: min(620px, 58vw);
          border-radius: 40%;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background:
            radial-gradient(circle at 35% 32%, rgba(214, 255, 115, 0.2), transparent 30%),
            radial-gradient(circle at 65% 65%, rgba(126, 224, 164, 0.22), transparent 34%),
            rgba(255, 255, 255, 0.035);
          filter: blur(0.2px);
          transform: rotate(18deg);
          opacity: 0.86;
        }

        .dy-hyper-stage {
          position: relative;
          width: min(1180px, calc(100vw - 48px));
          min-height: 680px;
          display: grid;
          grid-template-columns: 210px minmax(0, 1fr);
          align-items: center;
          gap: 34px;
          z-index: 1;
        }

        .dy-hyper-index {
          display: grid;
          gap: 14px;
        }

        .dy-hyper-label {
          gap: 11px;
          color: rgba(244, 248, 242, 0.64);
          font-size: 15px;
          font-weight: 820;
        }

        .dy-hyper-label span:first-child {
          width: 36px;
          color: var(--dy-accent);
          font-variant-numeric: tabular-nums;
        }

        .dy-hyper-deck {
          position: relative;
          min-height: 680px;
        }

        .dy-hyper-card {
          position: absolute;
          inset: 0;
          border: 1px solid var(--dy-line-strong);
          border-radius: 34px;
          overflow: hidden;
          background: #121914;
          box-shadow:
            0 44px 130px rgba(0, 0, 0, 0.42),
            inset 0 1px rgba(255, 255, 255, 0.14);
        }

        .dy-daoyou-console {
          position: absolute;
          z-index: 3;
          top: 24px;
          right: 24px;
          width: min(390px, 42%);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 24px;
          background: rgba(8, 11, 10, 0.68);
          backdrop-filter: blur(18px);
          padding: 15px;
          box-shadow: 0 28px 90px rgba(0, 0, 0, 0.3);
        }

        .dy-daoyou-top {
          justify-content: space-between;
          gap: 12px;
          color: rgba(244, 248, 242, 0.72);
          font-size: 12px;
          font-weight: 820;
        }

        .dy-daoyou-brand {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .dy-daoyou-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--dy-accent);
          box-shadow: 0 0 18px rgba(126, 224, 164, 0.72);
        }

        .dy-daoyou-prompt {
          gap: 10px;
          margin-top: 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.08);
          padding: 12px;
          color: var(--dy-text);
          font-size: 15px;
          line-height: 1.32;
          font-weight: 820;
        }

        .dy-prompt-mark {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          flex: none;
          border-radius: 9px;
          background: var(--dy-text);
          color: var(--dy-ink);
          font-size: 13px;
          font-weight: 900;
        }

        .dy-status-lane {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 12px;
        }

        .dy-lane-node {
          height: 40px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(126, 224, 164, 0.18);
          border-radius: 13px;
          background: rgba(126, 224, 164, 0.1);
          color: rgba(244, 248, 242, 0.72);
          font-size: 12px;
          font-weight: 780;
        }

        .dy-artifact-tray {
          justify-content: space-between;
          gap: 10px;
          margin-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 12px;
        }

        .dy-artifact-tray span {
          color: rgba(244, 248, 242, 0.46);
          font-size: 11px;
          font-weight: 820;
        }

        .dy-artifact-tray strong {
          color: var(--dy-text);
          font-size: 14px;
          font-weight: 880;
        }

        .dy-frame-meta {
          position: absolute;
          z-index: 2;
          left: 24px;
          right: 24px;
          bottom: 24px;
          justify-content: space-between;
          gap: 18px;
        }

        .dy-frame-copy {
          max-width: 620px;
        }

        .dy-frame-label {
          display: block;
          color: var(--dy-accent);
          font-size: 14px;
          font-weight: 850;
        }

        .dy-frame-copy h2 {
          margin: 8px 0 0;
          font-size: clamp(46px, 6vw, 86px);
          line-height: 0.95;
          letter-spacing: 0;
          font-weight: 920;
        }

        .dy-frame-copy p {
          margin: 14px 0 0;
          color: rgba(244, 248, 242, 0.74);
          font-size: clamp(18px, 2vw, 24px);
          line-height: 1.36;
          font-weight: 760;
        }

        .dy-frame-no {
          color: rgba(244, 248, 242, 0.34);
          font-size: clamp(52px, 8vw, 120px);
          line-height: 0.82;
          font-weight: 920;
          font-variant-numeric: tabular-nums;
        }

        .dy-final {
          min-height: 72dvh;
          display: grid;
          place-items: center;
          padding: 96px 24px 110px;
          background:
            linear-gradient(180deg, var(--dy-bg), #111813);
          text-align: center;
        }

        .dy-final h2 {
          max-width: 880px;
          margin: 0 auto;
          font-size: clamp(48px, 7vw, 94px);
          line-height: 0.98;
          letter-spacing: 0;
          font-weight: 920;
        }

        .dy-final p {
          max-width: 480px;
          margin: 22px auto 0;
          color: var(--dy-muted);
          font-size: 19px;
          line-height: 1.6;
        }

        .dy-final .dy-cta-row {
          justify-content: center;
        }

        @media (prefers-reduced-motion: reduce) {
          .dy-cta {
            transition: none;
          }
          .dy-cta:hover,
          .dy-cta:active {
            transform: none;
          }
        }

        @media (max-width: 980px) {
          .dy-nav {
            display: none;
          }

          .dy-hero {
            min-height: auto;
            padding-top: 98px;
          }

          .dy-hero-layout,
          .dy-hyper-stage {
            grid-template-columns: 1fr;
          }

          .dy-hero-layout {
            min-height: auto;
          }

          .dy-orbit {
            min-height: 560px;
          }

          .dy-hyper-pin {
            min-height: auto;
            padding-top: 82px;
          }

          .dy-hyper-stage {
            min-height: auto;
          }

          .dy-hyper-index {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
          }

          .dy-hyper-label {
            display: grid;
            gap: 4px;
            font-size: 12px;
          }

          .dy-hyper-label span:first-child {
            width: auto;
          }

          .dy-hyper-deck {
            min-height: auto;
            display: grid;
            gap: 16px;
          }

          .dy-hyper-card {
            position: relative;
            min-height: 520px;
            opacity: 1;
            visibility: visible;
          }
        }

        @media (max-width: 640px) {
          .dy-header {
            height: 66px;
          }

          .dy-header-inner,
          .dy-wide,
          .dy-hero-layout,
          .dy-hyper-stage {
            width: min(100% - 32px, 1240px);
          }

          .dy-actions > a:first-child {
            display: none;
          }

          .dy-header-button {
            padding: 8px 14px;
          }

          .dy-hero {
            padding: 92px 16px 46px;
          }

          .dy-hero h1 {
            font-size: clamp(46px, 15vw, 66px);
          }

          .dy-hero-copy p {
            font-size: 17px;
          }

          .dy-cta {
            width: 100%;
          }

          .dy-orbit {
            min-height: 470px;
          }

          .dy-orbit-frame:nth-child(1) {
            left: 0;
            top: 9%;
            width: 66%;
          }

          .dy-orbit-frame:nth-child(2) {
            right: 0;
            top: 0;
            width: 70%;
          }

          .dy-orbit-frame:nth-child(3) {
            left: 7%;
            bottom: 8%;
            width: 78%;
          }

          .dy-orbit-frame:nth-child(4) {
            right: 2%;
            bottom: 18%;
            width: 48%;
          }

          .dy-chipline {
            display: none;
          }

          .dy-orbit-command {
            width: 74%;
            left: 0;
            top: 6%;
          }

          .dy-orbit-output {
            width: 150px;
            right: 0;
            top: 48%;
          }

          .dy-hyper-pin,
          .dy-final {
            padding-left: 16px;
            padding-right: 16px;
          }

          .dy-hyper-index {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .dy-hyper-card {
            min-height: 430px;
            border-radius: 24px;
          }

          .dy-daoyou-console {
            top: 14px;
            right: 14px;
            left: 14px;
            width: auto;
            border-radius: 18px;
            padding: 12px;
          }

          .dy-status-lane {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .dy-lane-node {
            height: 34px;
            font-size: 11px;
          }

          .dy-frame-meta {
            left: 16px;
            right: 16px;
            bottom: 16px;
            align-items: flex-end;
          }

          .dy-frame-copy h2 {
            font-size: clamp(34px, 10vw, 46px);
          }

          .dy-frame-copy p {
            font-size: 17px;
          }

          .dy-frame-no {
            font-size: 48px;
          }

          .dy-final h2 {
            font-size: clamp(42px, 12vw, 62px);
          }
        }
      `}</style>

      <header className="dy-header">
        <div className="dy-header-inner">
          <a className="dy-brand" href="/" aria-label="道友 AI 首页">
            <span className="dy-brand-mark" aria-hidden="true">
              道
            </span>
            <span>道友 AI</span>
          </a>
          <nav className="dy-nav" aria-label="产品导航">
            <a href="#product">道友 AI</a>
            <a href="#hyperframes">HyperFrames</a>
            <a href="/login">登录</a>
          </nav>
          <div className="dy-actions">
            <a href="/login">登录</a>
            <a className="dy-header-button" href="/login">
              开始使用
            </a>
          </div>
        </div>
      </header>

      <section className="dy-hero" id="product">
        <div className="dy-hero-layout">
          <div className="dy-hero-copy">
            <h1 className="dy-hero-motion" aria-label="随心而动，念头通达">
              <span>随心而动，</span>
              <span className="dy-title-soft">念头通达</span>
            </h1>
            <p className="dy-hero-motion">一句话，启动一组会做事的画面。</p>
            <div className="dy-cta-row dy-hero-motion">
              <a className="dy-cta dy-cta-primary" href="/login">
                <span className="dy-cta-icon" aria-hidden="true">
                  道
                </span>
                <span>
                  <span className="dy-cta-title">开始使用</span>
                  <span className="dy-cta-desc">进入工作空间</span>
                </span>
              </a>
              <a className="dy-cta dy-cta-secondary" href="#hyperframes">
                <span className="dy-cta-icon" aria-hidden="true">
                  <ArrowRightIcon width={17} height={17} strokeWidth={2.4} />
                </span>
                <span>
                  <span className="dy-cta-title">看动画</span>
                  <span className="dy-cta-desc">HyperFrames</span>
                </span>
              </a>
            </div>
          </div>

          <div className="dy-orbit" aria-label="道友 AI 动画帧预览">
            <div className="dy-orbit-command dy-daoyou-ui">
              <span>念头输入</span>
              <strong>帮我把资料、网页和待办整理成结果。</strong>
            </div>
            {frames.map(({ Icon, ...frame }) => (
              <figure className="dy-orbit-frame" key={frame.label}>
                <div className="dy-orbit-media">
                  <img src={frame.image} alt={frame.alt} />
                </div>
                <figcaption className="dy-shot-tag">
                  <span className="dy-shot-icon" aria-hidden="true">
                    <Icon strokeWidth={1.8} />
                  </span>
                  <span>{frame.label}</span>
                </figcaption>
              </figure>
            ))}
            <div className="dy-orbit-output dy-daoyou-ui">
              <span>道友交付</span>
              <strong>报告 / 索引 / 提醒</strong>
            </div>
            <div className="dy-chipline" aria-label="道友 AI 工作流">
              {frames.map((frame) => (
                <span className="dy-orbit-chip" key={frame.label}>
                  {frame.caption}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="dy-hyper" id="hyperframes">
        <div className="dy-hyper-pin">
          <div className="dy-hyper-glass" aria-hidden="true" />
          <div className="dy-hyper-stage">
            <div className="dy-hyper-index" aria-label="动画帧索引">
              {frames.map((frame, index) => (
                <div className="dy-hyper-label" key={frame.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{frame.label}</strong>
                </div>
              ))}
            </div>
            <div className="dy-hyper-deck">
              {frames.map((frame, index) => (
                <article className="dy-hyper-card" key={frame.label}>
                  <div className="dy-hyper-media">
                    <img src={frame.image} alt={frame.alt} />
                  </div>
                  <div className="dy-daoyou-console">
                    <div className="dy-daoyou-top">
                      <span className="dy-daoyou-brand">
                        <span className="dy-daoyou-dot" aria-hidden="true" />
                        道友执行中
                      </span>
                      <span>{frame.status}</span>
                    </div>
                    <div className="dy-daoyou-prompt">
                      <span className="dy-prompt-mark" aria-hidden="true">
                        道
                      </span>
                      <span>{frame.command}</span>
                    </div>
                    <div className="dy-status-lane" aria-hidden="true">
                      <span className="dy-lane-node">理解</span>
                      <span className="dy-lane-node">执行</span>
                      <span className="dy-lane-node">交付</span>
                    </div>
                    <div className="dy-artifact-tray">
                      <span>交付物</span>
                      <strong>{frame.output}</strong>
                    </div>
                  </div>
                  <div className="dy-frame-meta">
                    <div className="dy-frame-copy">
                      <span className="dy-frame-label">{frame.label}</span>
                      <h2>{frame.title}</h2>
                      <p>{frame.caption}</p>
                    </div>
                    <div className="dy-frame-no" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="dy-final">
        <div>
          <h2 className="dy-final-motion">把念头交给道友 AI。</h2>
          <p className="dy-final-motion">它会把画面推进成结果。</p>
          <div className="dy-cta-row dy-final-motion">
            <a className="dy-cta dy-cta-primary" href="/login">
              <span className="dy-cta-icon" aria-hidden="true">
                道
              </span>
              <span>
                <span className="dy-cta-title">立即开始</span>
                <span className="dy-cta-desc">进入道友 AI</span>
              </span>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
