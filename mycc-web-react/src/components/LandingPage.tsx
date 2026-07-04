import { useRef } from "react";
import {
  ArrowRightIcon,
  BellAlertIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const assetBase = "/landing";

const executionScenes = [
  {
    label: "调研",
    title: "网页调研与结论报告",
    image: `${assetBase}/scene-web-research.jpg`,
    alt: "道友 AI 网页调研场景",
    prompt: "调研这周竞品动态，保留来源，整理成可转发报告。",
    work: ["打开网页来源", "提取购买理由", "合并重复观点"],
    result: "输出竞品变化、机会点和引用来源。",
    Icon: MagnifyingGlassIcon,
  },
  {
    label: "整理",
    title: "资料整理与成果包",
    image: `${assetBase}/scene-file-organize.jpg`,
    alt: "道友 AI 资料整理场景",
    prompt: "把桌面文件、截图和表格按项目归档，生成一份索引。",
    work: ["识别文件类型", "按主题归档", "生成可检索目录"],
    result: "资料变成清楚的项目包，后续可以继续编辑。",
    Icon: FolderOpenIcon,
  },
  {
    label: "生成",
    title: "周报与汇报文档",
    image: `${assetBase}/scene-weekly-report.jpg`,
    alt: "道友 AI 周报生成场景",
    prompt: "把本周进展、风险和下周计划写成老板能看的版本。",
    work: ["合并任务进度", "补齐风险说明", "生成不同口径"],
    result: "交付周报、汇报摘要和下一步计划。",
    Icon: DocumentTextIcon,
  },
  {
    label: "跟进",
    title: "会议后续与自动跟进",
    image: `${assetBase}/scene-follow-up.jpg`,
    alt: "道友 AI 自动跟进场景",
    prompt: "根据会议纪要创建待办，周五提醒我检查交付。",
    work: ["识别负责人", "创建提醒", "记录执行状态"],
    result: "待办不丢，时间到了自动接着推进。",
    Icon: BellAlertIcon,
  },
];

const dailyScenes = [
  "把公众号文章整理成内部分享稿",
  "把一堆截图归纳成产品需求",
  "读网页资料并输出选型建议",
  "跟踪供应商报价和待办变化",
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
            gsap.set(".dy-reveal, .dy-hero-motion, .dy-flow-panel", {
              autoAlpha: 1,
              clearProps: "transform,visibility,opacity",
            });
            return;
          }

          const heroTimeline = gsap.timeline({
            defaults: { ease: "power3.out", duration: 0.85 },
          });

          heroTimeline
            .from(".dy-header", { autoAlpha: 0, y: -16, duration: 0.5 })
            .from(
              ".dy-hero-motion",
              {
                autoAlpha: 0,
                y: 42,
                stagger: 0.08,
              },
              "-=0.08",
            )
            .from(
              ".dy-stage",
              { autoAlpha: 0, y: 54, scale: 0.985, duration: 1.05 },
              "-=0.48",
            )
            .from(
              ".dy-live-row",
              { autoAlpha: 0, x: -18, stagger: 0.08, duration: 0.58 },
              "-=0.55",
            )
            .from(
              ".dy-artifact",
              { autoAlpha: 0, y: 18, stagger: 0.07, duration: 0.58 },
              "-=0.42",
            );

          gsap.to(".dy-stage-media img", {
            yPercent: isDesktop ? -9 : -4,
            scale: 1.04,
            ease: "none",
            scrollTrigger: {
              trigger: ".dy-hero",
              start: "top top",
              end: "bottom top",
              scrub: 0.8,
              refreshPriority: 0,
            },
          });

          gsap.to(".dy-scan-line", {
            yPercent: 760,
            repeat: -1,
            duration: 3.2,
            ease: "none",
          });

          gsap.set(".dy-reveal", { autoAlpha: 0, y: 38 });
          ScrollTrigger.batch(".dy-reveal", {
            start: "top 82%",
            once: true,
            onEnter: (elements) => {
              gsap.to(elements, {
                autoAlpha: 1,
                y: 0,
                stagger: 0.08,
                duration: 0.72,
                ease: "power3.out",
                overwrite: "auto",
              });
            },
          });

          if (isDesktop) {
            const flow = document.querySelector<HTMLElement>(".dy-flow");
            const pin = document.querySelector<HTMLElement>(".dy-flow-pin");
            const track = document.querySelector<HTMLElement>(".dy-flow-track");
            const progress = document.querySelector<HTMLElement>(
              ".dy-flow-progress-fill",
            );

            if (flow && pin && track) {
              const getDistance = () =>
                Math.max(0, track.scrollWidth - flow.clientWidth + 96);

              const panTween = gsap.to(track, {
                x: () => -getDistance(),
                ease: "none",
                scrollTrigger: {
                  trigger: flow,
                  start: "top top",
                  end: () => `+=${getDistance()}`,
                  pin,
                  scrub: 1,
                  invalidateOnRefresh: true,
                  refreshPriority: 1,
                },
              });

              if (progress) {
                gsap.fromTo(
                  progress,
                  { scaleX: 0 },
                  {
                    scaleX: 1,
                    ease: "none",
                    transformOrigin: "left center",
                    scrollTrigger: {
                      trigger: flow,
                      start: "top top",
                      end: () => `+=${getDistance()}`,
                      scrub: 1,
                      invalidateOnRefresh: true,
                      refreshPriority: 1,
                    },
                  },
                );
              }

              gsap.utils
                .toArray<HTMLElement>(".dy-flow-panel")
                .forEach((panel) => {
                  gsap.from(panel.querySelectorAll(".dy-panel-motion"), {
                    autoAlpha: 0,
                    y: 24,
                    stagger: 0.07,
                    duration: 0.7,
                    ease: "power3.out",
                    scrollTrigger: {
                      trigger: panel,
                      containerAnimation: panTween,
                      start: "left 72%",
                      toggleActions: "play none none reverse",
                    },
                  });
                });
            }
          }

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
          --dy-bg: #0a0d0c;
          --dy-bg-2: #111715;
          --dy-surface: rgba(255, 255, 255, 0.07);
          --dy-surface-strong: rgba(255, 255, 255, 0.11);
          --dy-line: rgba(232, 244, 236, 0.14);
          --dy-line-strong: rgba(232, 244, 236, 0.26);
          --dy-text: #f4f7f3;
          --dy-muted: rgba(244, 247, 243, 0.68);
          --dy-soft: rgba(244, 247, 243, 0.48);
          --dy-paper: #edf2ea;
          --dy-paper-2: #dfe8dd;
          --dy-ink: #111715;
          --dy-ink-muted: #5d685f;
          --dy-accent: #71d69b;
          --dy-accent-2: #c7f36b;
          min-height: 100dvh;
          overflow-x: hidden;
          background:
            linear-gradient(180deg, rgba(20, 29, 25, 0.96), var(--dy-bg) 42%),
            var(--dy-bg);
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
          z-index: 20;
          height: 70px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(10, 13, 12, 0.78);
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
          gap: 24px;
        }

        .dy-brand {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-size: 18px;
          font-weight: 820;
          letter-spacing: 0;
          white-space: nowrap;
        }

        .dy-brand-mark,
        .dy-icon-mark,
        .dy-cta-icon {
          display: grid;
          place-items: center;
          flex: none;
        }

        .dy-brand-mark {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent 35%),
            linear-gradient(135deg, #1f382b, #71d69b);
          color: #f7fff8;
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 14px 36px rgba(64, 188, 124, 0.22);
          font-size: 18px;
          font-weight: 900;
        }

        .dy-nav,
        .dy-actions {
          display: flex;
          align-items: center;
          white-space: nowrap;
        }

        .dy-nav {
          gap: 26px;
          color: rgba(244, 247, 243, 0.62);
          font-size: 14px;
          font-weight: 620;
        }

        .dy-actions {
          gap: 16px;
          color: rgba(244, 247, 243, 0.74);
          font-size: 14px;
          font-weight: 720;
        }

        .dy-header-button {
          border-radius: 999px;
          background: var(--dy-text);
          color: var(--dy-ink);
          padding: 9px 17px;
          font-weight: 800;
        }

        .dy-hero {
          position: relative;
          min-height: 100dvh;
          padding: 112px 24px 72px;
          overflow: hidden;
        }

        .dy-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: linear-gradient(to bottom, black 0%, transparent 76%);
          pointer-events: none;
        }

        .dy-hero::after {
          content: "";
          position: absolute;
          left: 12%;
          right: 12%;
          bottom: 42px;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(113, 214, 155, 0.52),
            transparent
          );
          pointer-events: none;
        }

        .dy-hero-layout {
          position: relative;
          z-index: 1;
          width: min(1240px, calc(100vw - 48px));
          min-height: calc(100dvh - 184px);
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(560px, 1.1fr);
          align-items: center;
          gap: clamp(34px, 6vw, 78px);
        }

        .dy-kicker {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          width: fit-content;
          margin: 0 0 22px;
          border: 1px solid var(--dy-line);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          padding: 8px 12px;
          color: rgba(244, 247, 243, 0.72);
          font-size: 13px;
          font-weight: 730;
        }

        .dy-kicker svg {
          width: 16px;
          height: 16px;
          color: var(--dy-accent);
        }

        .dy-hero h1 {
          max-width: 660px;
          margin: 0;
          font-size: clamp(58px, 7.4vw, 102px);
          line-height: 0.96;
          letter-spacing: 0;
          font-weight: 900;
        }

        .dy-title-soft {
          display: block;
          color: rgba(244, 247, 243, 0.66);
        }

        .dy-hero-copy p {
          max-width: 600px;
          margin: 26px 0 0;
          color: var(--dy-muted);
          font-size: clamp(18px, 1.8vw, 22px);
          line-height: 1.62;
        }

        .dy-hero-motion,
        .dy-reveal,
        .dy-stage,
        .dy-stage-media img,
        .dy-flow-track,
        .dy-flow-panel,
        .dy-panel-motion,
        .dy-scan-line {
          will-change: transform, opacity;
        }

        .dy-cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 34px;
        }

        .dy-cta {
          min-height: 58px;
          display: inline-flex;
          align-items: center;
          gap: 12px;
          border-radius: 16px;
          padding: 12px 16px;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease;
        }

        .dy-cta:hover {
          transform: translateY(-2px);
        }

        .dy-cta:active {
          transform: translateY(0);
        }

        .dy-cta-primary {
          min-width: 168px;
          background: var(--dy-text);
          color: var(--dy-ink);
          box-shadow: 0 22px 52px rgba(0, 0, 0, 0.32);
        }

        .dy-cta-secondary {
          border: 1px solid var(--dy-line);
          background: rgba(255, 255, 255, 0.065);
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
          font-weight: 820;
          line-height: 1.12;
        }

        .dy-cta-desc {
          margin-top: 4px;
          color: #637064;
          font-size: 12px;
          font-weight: 660;
        }

        .dy-cta-secondary .dy-cta-desc {
          color: rgba(244, 247, 243, 0.55);
        }

        .dy-stage {
          position: relative;
          min-height: 650px;
          border: 1px solid var(--dy-line-strong);
          border-radius: 28px;
          overflow: hidden;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.12), transparent 28%),
            #0f1513;
          box-shadow:
            0 48px 140px rgba(0, 0, 0, 0.45),
            inset 0 1px rgba(255, 255, 255, 0.16);
        }

        .dy-stage-top {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 1px solid var(--dy-line);
          padding: 0 18px;
          background: rgba(255, 255, 255, 0.05);
        }

        .dy-window-dots {
          display: flex;
          gap: 7px;
        }

        .dy-window-dots span {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: rgba(244, 247, 243, 0.32);
        }

        .dy-stage-title {
          color: rgba(244, 247, 243, 0.68);
          font-size: 13px;
          font-weight: 720;
        }

        .dy-stage-body {
          position: relative;
          min-height: 600px;
          padding: 22px;
        }

        .dy-stage-media {
          position: absolute;
          inset: 22px;
          border-radius: 22px;
          overflow: hidden;
          opacity: 0.72;
        }

        .dy-stage-media::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(10, 13, 12, 0.94) 0%, rgba(10, 13, 12, 0.74) 45%, rgba(10, 13, 12, 0.24) 100%),
            linear-gradient(180deg, transparent 35%, rgba(10, 13, 12, 0.76));
        }

        .dy-stage-media img,
        .dy-panel-image img,
        .dy-showcase-image img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .dy-stage-content {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: 1fr 0.88fr;
          gap: 18px;
          min-height: 556px;
        }

        .dy-command {
          align-self: end;
          border: 1px solid var(--dy-line);
          border-radius: 22px;
          background: rgba(10, 13, 12, 0.72);
          backdrop-filter: blur(18px);
          padding: 20px;
        }

        .dy-command-label {
          display: block;
          margin-bottom: 12px;
          color: var(--dy-soft);
          font-size: 13px;
          font-weight: 720;
        }

        .dy-command-text {
          margin: 0;
          color: var(--dy-text);
          font-size: clamp(22px, 2.4vw, 30px);
          line-height: 1.28;
          font-weight: 850;
        }

        .dy-command-footer {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
        }

        .dy-chip {
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.07);
          padding: 7px 10px;
          color: rgba(244, 247, 243, 0.68);
          font-size: 12px;
          font-weight: 680;
        }

        .dy-live {
          align-self: stretch;
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: 14px;
          border: 1px solid var(--dy-line);
          border-radius: 22px;
          background: rgba(237, 242, 234, 0.92);
          color: var(--dy-ink);
          padding: 16px;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.22);
        }

        .dy-live-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .dy-live-head strong {
          font-size: 15px;
        }

        .dy-live-state {
          color: #386c4a;
          font-size: 12px;
          font-weight: 820;
        }

        .dy-live-list {
          display: grid;
          gap: 10px;
          align-content: start;
        }

        .dy-live-row {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 10px;
          align-items: start;
          border: 1px solid rgba(17, 23, 21, 0.08);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.55);
          padding: 11px;
        }

        .dy-live-row svg {
          width: 20px;
          height: 20px;
          color: #2e8b57;
        }

        .dy-live-row strong {
          display: block;
          margin-bottom: 3px;
          font-size: 13px;
        }

        .dy-live-row span {
          color: #657269;
          font-size: 12px;
          line-height: 1.45;
        }

        .dy-artifacts {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .dy-artifact {
          min-height: 76px;
          border: 1px solid rgba(17, 23, 21, 0.08);
          border-radius: 15px;
          background: #fff;
          padding: 11px;
        }

        .dy-artifact span {
          display: block;
          color: #758177;
          font-size: 11px;
          font-weight: 760;
        }

        .dy-artifact strong {
          display: block;
          margin-top: 7px;
          font-size: 13px;
          line-height: 1.25;
        }

        .dy-scan-line {
          position: absolute;
          left: 0;
          right: 0;
          top: 88px;
          z-index: 2;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(113, 214, 155, 0.9),
            transparent
          );
          opacity: 0.66;
          pointer-events: none;
        }

        .dy-manifest {
          position: relative;
          background: var(--dy-paper);
          color: var(--dy-ink);
          padding: 96px 24px;
        }

        .dy-manifest-grid {
          display: grid;
          grid-template-columns: 0.9fr 1.1fr;
          gap: 56px;
          align-items: end;
        }

        .dy-manifest h2,
        .dy-flow-copy h2,
        .dy-showcase h2,
        .dy-final h2 {
          margin: 0;
          font-size: clamp(42px, 5.8vw, 78px);
          line-height: 1.04;
          letter-spacing: 0;
          font-weight: 900;
        }

        .dy-manifest p,
        .dy-flow-copy p,
        .dy-showcase p,
        .dy-final p {
          margin: 0;
          color: var(--dy-ink-muted);
          font-size: 19px;
          line-height: 1.72;
        }

        .dy-manifest-copy {
          display: grid;
          gap: 18px;
        }

        .dy-sentence-stack {
          display: grid;
          gap: 12px;
          margin-top: 26px;
        }

        .dy-sentence {
          border-left: 3px solid var(--dy-accent);
          padding-left: 16px;
          color: #314037;
          font-size: 17px;
          line-height: 1.55;
          font-weight: 700;
        }

        .dy-flow {
          position: relative;
          background: var(--dy-bg);
        }

        .dy-flow-pin {
          min-height: 100dvh;
          overflow: hidden;
          padding: 92px 0 82px;
        }

        .dy-flow-head {
          display: grid;
          grid-template-columns: minmax(0, 0.82fr) minmax(360px, 1fr);
          gap: 40px;
          align-items: end;
          margin-bottom: 34px;
        }

        .dy-flow-copy p {
          max-width: 560px;
          margin-top: 20px;
          color: var(--dy-muted);
        }

        .dy-flow-progress {
          align-self: end;
          height: 3px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          overflow: hidden;
        }

        .dy-flow-progress-fill {
          width: 100%;
          height: 100%;
          transform: scaleX(0);
          transform-origin: left center;
          border-radius: inherit;
          background: linear-gradient(90deg, var(--dy-accent), var(--dy-accent-2));
        }

        .dy-flow-track {
          display: flex;
          gap: 22px;
          width: max-content;
          padding: 0 max(24px, calc((100vw - 1240px) / 2));
        }

        .dy-flow-panel {
          width: min(980px, calc(100vw - 112px));
          min-height: 560px;
          display: grid;
          grid-template-columns: 0.95fr 1.05fr;
          gap: 22px;
          border: 1px solid var(--dy-line);
          border-radius: 28px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent 30%),
            var(--dy-bg-2);
          padding: 18px;
          box-shadow: 0 34px 100px rgba(0, 0, 0, 0.28);
        }

        .dy-panel-copy {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 28px;
          padding: 18px;
        }

        .dy-panel-top {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .dy-icon-mark {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(113, 214, 155, 0.12);
          color: var(--dy-accent);
          border: 1px solid rgba(113, 214, 155, 0.26);
        }

        .dy-icon-mark svg {
          width: 22px;
          height: 22px;
        }

        .dy-panel-label {
          display: block;
          color: var(--dy-soft);
          font-size: 13px;
          font-weight: 760;
        }

        .dy-panel-copy h3 {
          margin: 6px 0 0;
          font-size: clamp(32px, 3.6vw, 50px);
          line-height: 1.05;
          letter-spacing: 0;
          font-weight: 900;
        }

        .dy-prompt {
          margin: 22px 0 0;
          border: 1px solid var(--dy-line);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.06);
          padding: 15px;
          color: rgba(244, 247, 243, 0.78);
          font-size: 15px;
          line-height: 1.58;
        }

        .dy-work-list {
          display: grid;
          gap: 10px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .dy-work-list li {
          display: flex;
          align-items: center;
          gap: 10px;
          color: rgba(244, 247, 243, 0.72);
          font-size: 14px;
          font-weight: 650;
        }

        .dy-work-list svg {
          width: 18px;
          height: 18px;
          color: var(--dy-accent);
          flex: none;
        }

        .dy-result {
          border-top: 1px solid var(--dy-line);
          padding-top: 18px;
          color: var(--dy-text);
          font-size: 18px;
          line-height: 1.55;
          font-weight: 780;
        }

        .dy-panel-image {
          position: relative;
          min-height: 520px;
          border-radius: 22px;
          overflow: hidden;
          background: #16201c;
        }

        .dy-panel-image::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, transparent 44%, rgba(10, 13, 12, 0.72)),
            linear-gradient(90deg, rgba(10, 13, 12, 0.34), transparent 56%);
          pointer-events: none;
        }

        .dy-panel-output {
          position: absolute;
          left: 18px;
          right: 18px;
          bottom: 18px;
          z-index: 1;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 18px;
          background: rgba(10, 13, 12, 0.72);
          backdrop-filter: blur(16px);
          padding: 14px;
        }

        .dy-panel-output strong {
          display: block;
          margin-bottom: 8px;
          color: var(--dy-text);
          font-size: 14px;
        }

        .dy-output-lines {
          display: grid;
          gap: 7px;
        }

        .dy-output-lines span {
          height: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.22);
        }

        .dy-output-lines span:nth-child(2) {
          width: 82%;
        }

        .dy-output-lines span:nth-child(3) {
          width: 58%;
          background: rgba(113, 214, 155, 0.42);
        }

        .dy-showcase {
          background: var(--dy-paper);
          color: var(--dy-ink);
          padding: 102px 24px;
        }

        .dy-showcase-layout {
          display: grid;
          grid-template-columns: 0.88fr 1.12fr;
          gap: 46px;
          align-items: center;
        }

        .dy-showcase p {
          max-width: 520px;
          margin-top: 20px;
        }

        .dy-showcase-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 28px;
        }

        .dy-showcase-item {
          border: 1px solid rgba(17, 23, 21, 0.12);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.56);
          padding: 16px;
          color: #314037;
          font-size: 15px;
          line-height: 1.45;
          font-weight: 720;
        }

        .dy-showcase-image {
          min-height: 520px;
          border: 1px solid rgba(17, 23, 21, 0.14);
          border-radius: 28px;
          overflow: hidden;
          background: #1a241f;
          box-shadow: 0 28px 80px rgba(17, 23, 21, 0.14);
        }

        .dy-final {
          position: relative;
          overflow: hidden;
          padding: 108px 24px 118px;
          background:
            linear-gradient(180deg, var(--dy-bg-2), var(--dy-bg));
          text-align: center;
        }

        .dy-final::before {
          content: "";
          position: absolute;
          left: 50%;
          top: 0;
          width: min(920px, 82vw);
          height: 1px;
          transform: translateX(-50%);
          background: linear-gradient(
            90deg,
            transparent,
            rgba(113, 214, 155, 0.58),
            transparent
          );
        }

        .dy-final h2 {
          max-width: 880px;
          margin: 0 auto;
        }

        .dy-final p {
          max-width: 600px;
          margin: 24px auto 0;
          color: var(--dy-muted);
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
          .dy-scan-line {
            display: none;
          }
        }

        @media (max-width: 980px) {
          .dy-nav {
            display: none;
          }
          .dy-hero {
            min-height: auto;
            padding-top: 108px;
          }
          .dy-hero-layout,
          .dy-stage-content,
          .dy-manifest-grid,
          .dy-flow-head,
          .dy-flow-panel,
          .dy-showcase-layout {
            grid-template-columns: 1fr;
          }
          .dy-hero-layout {
            min-height: auto;
          }
          .dy-stage {
            min-height: auto;
          }
          .dy-stage-body,
          .dy-stage-content {
            min-height: 560px;
          }
          .dy-command {
            align-self: start;
          }
          .dy-flow-pin {
            min-height: auto;
          }
          .dy-flow-track {
            width: auto;
            display: grid;
            padding: 0 24px;
          }
          .dy-flow-panel {
            width: 100%;
            min-height: auto;
          }
          .dy-panel-image {
            min-height: 360px;
          }
          .dy-flow-progress {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .dy-header {
            height: 66px;
          }
          .dy-header-inner,
          .dy-wide,
          .dy-hero-layout {
            width: min(100% - 32px, 1240px);
          }
          .dy-actions {
            gap: 10px;
          }
          .dy-actions > a:first-child {
            display: none;
          }
          .dy-header-button {
            padding: 8px 14px;
          }
          .dy-hero {
            padding: 96px 16px 56px;
          }
          .dy-hero h1 {
            font-size: clamp(42px, 14vw, 62px);
          }
          .dy-hero-copy p {
            font-size: 17px;
          }
          .dy-cta {
            width: 100%;
          }
          .dy-stage-top {
            padding: 0 14px;
          }
          .dy-stage-body {
            padding: 14px;
          }
          .dy-stage-media {
            inset: 14px;
          }
          .dy-stage-body,
          .dy-stage-content {
            min-height: 620px;
          }
          .dy-command,
          .dy-live {
            border-radius: 18px;
            padding: 14px;
          }
          .dy-artifacts,
          .dy-showcase-list {
            grid-template-columns: 1fr;
          }
          .dy-manifest,
          .dy-flow-pin,
          .dy-showcase,
          .dy-final {
            padding-left: 16px;
            padding-right: 16px;
          }
          .dy-manifest h2,
          .dy-flow-copy h2,
          .dy-showcase h2,
          .dy-final h2 {
            font-size: clamp(36px, 10vw, 48px);
          }
          .dy-flow-track {
            padding: 0;
          }
          .dy-flow-panel {
            border-radius: 22px;
            padding: 12px;
          }
          .dy-panel-copy {
            padding: 8px;
          }
          .dy-panel-image,
          .dy-showcase-image {
            min-height: 300px;
            border-radius: 18px;
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
            <a href="#flow">场景演示</a>
            <a href="#daily">日常工作</a>
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
            <div className="dy-kicker dy-hero-motion">
              <SparklesIcon strokeWidth={2} />
              <span>桌面级通用智能体助手</span>
            </div>
            <h1 className="dy-hero-motion" aria-label="随心而动，念头通达">
              <span>随心而动，</span>
              <span className="dy-title-soft">念头通达</span>
            </h1>
            <p className="dy-hero-motion">
              描述你想完成的事，道友 AI
              会调研、整理、生成文档，并把后续动作接住。
            </p>
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
              <a className="dy-cta dy-cta-secondary" href="#flow">
                <span className="dy-cta-icon" aria-hidden="true">
                  <ArrowRightIcon width={17} height={17} strokeWidth={2.4} />
                </span>
                <span>
                  <span className="dy-cta-title">查看演示</span>
                  <span className="dy-cta-desc">调研 / 整理 / 跟进</span>
                </span>
              </a>
            </div>
          </div>

          <div className="dy-stage" aria-label="道友 AI 执行台预览">
            <div className="dy-stage-top">
              <div className="dy-window-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="dy-stage-title">道友执行台</div>
            </div>
            <div className="dy-stage-body">
              <div className="dy-stage-media">
                <img
                  src={`${assetBase}/scene-weekly-report.jpg`}
                  alt="道友 AI 桌面工作台场景"
                />
              </div>
              <div className="dy-scan-line" aria-hidden="true" />
              <div className="dy-stage-content">
                <div className="dy-command">
                  <span className="dy-command-label">输入一个念头</span>
                  <p className="dy-command-text">
                    帮我调研竞品动态，整理成周报，并提醒我周五发送。
                  </p>
                  <div className="dy-command-footer" aria-label="任务范围">
                    <span className="dy-chip">网页来源</span>
                    <span className="dy-chip">本地资料</span>
                    <span className="dy-chip">文档交付</span>
                  </div>
                </div>

                <div className="dy-live">
                  <div className="dy-live-head">
                    <strong>执行中</strong>
                    <span className="dy-live-state">过程可见</span>
                  </div>
                  <div className="dy-live-list">
                    <div className="dy-live-row">
                      <MagnifyingGlassIcon strokeWidth={2} />
                      <span>
                        <strong>网页调研</strong>
                        <span>抓取资料、保留来源、提取变化。</span>
                      </span>
                    </div>
                    <div className="dy-live-row">
                      <FolderOpenIcon strokeWidth={2} />
                      <span>
                        <strong>资料整理</strong>
                        <span>把截图、链接、表格归入项目包。</span>
                      </span>
                    </div>
                    <div className="dy-live-row">
                      <DocumentTextIcon strokeWidth={2} />
                      <span>
                        <strong>生成结果</strong>
                        <span>周报、摘要和下周计划一起交付。</span>
                      </span>
                    </div>
                  </div>
                  <div className="dy-artifacts" aria-label="交付物">
                    <div className="dy-artifact">
                      <span>DOC</span>
                      <strong>周报初稿</strong>
                    </div>
                    <div className="dy-artifact">
                      <span>LINKS</span>
                      <strong>来源清单</strong>
                    </div>
                    <div className="dy-artifact">
                      <span>TODO</span>
                      <strong>周五提醒</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="dy-manifest dy-reveal">
        <div className="dy-wide dy-manifest-grid">
          <h2>一句话落地成一条工作流。</h2>
          <div className="dy-manifest-copy">
            <p>
              道友 AI
              面向真实工作场景：网页要读，文件要理，文档要交付，后续还要有人记得。
            </p>
            <div className="dy-sentence-stack">
              <div className="dy-sentence">从需求开始，不从工具菜单开始。</div>
              <div className="dy-sentence">过程透明，结果能继续编辑。</div>
              <div className="dy-sentence">
                日常反复做的事，让它自动接着做。
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="dy-flow" id="flow">
        <div className="dy-flow-pin">
          <div className="dy-wide dy-flow-head">
            <div className="dy-flow-copy dy-reveal">
              <h2>看它怎么把事做完。</h2>
              <p>
                这一段用滚动演示完整执行链路。每个场景都对应日常工作里会真的发生的任务。
              </p>
            </div>
            <div className="dy-flow-progress" aria-hidden="true">
              <div className="dy-flow-progress-fill" />
            </div>
          </div>

          <div className="dy-flow-track" aria-label="道友 AI 场景演示">
            {executionScenes.map(({ Icon, ...scene }) => (
              <article className="dy-flow-panel" key={scene.label}>
                <div className="dy-panel-copy">
                  <div>
                    <div className="dy-panel-top dy-panel-motion">
                      <span className="dy-icon-mark" aria-hidden="true">
                        <Icon strokeWidth={1.8} />
                      </span>
                      <span>
                        <span className="dy-panel-label">{scene.label}</span>
                        <h3>{scene.title}</h3>
                      </span>
                    </div>
                    <p className="dy-prompt dy-panel-motion">{scene.prompt}</p>
                  </div>

                  <ul className="dy-work-list dy-panel-motion">
                    {scene.work.map((item) => (
                      <li key={item}>
                        <CheckCircleIcon strokeWidth={2} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="dy-result dy-panel-motion">
                    {scene.result}
                  </div>
                </div>

                <div className="dy-panel-image">
                  <img src={scene.image} alt={scene.alt} />
                  <div className="dy-panel-output dy-panel-motion">
                    <strong>交付预览</strong>
                    <div className="dy-output-lines" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="dy-showcase" id="daily">
        <div className="dy-wide dy-showcase-layout">
          <div className="dy-reveal">
            <h2>日常工作里，直接开口。</h2>
            <p>
              不需要先想清楚该打开哪个工具。把任务说出来，道友 AI
              会把资料、网页和交付物串起来。
            </p>
            <div className="dy-showcase-list">
              {dailyScenes.map((scene) => (
                <div className="dy-showcase-item" key={scene}>
                  {scene}
                </div>
              ))}
            </div>
          </div>
          <div className="dy-showcase-image dy-reveal">
            <img
              src={`${assetBase}/scene-file-organize.jpg`}
              alt="道友 AI 日常资料整理场景"
            />
          </div>
        </div>
      </section>

      <section className="dy-final dy-reveal">
        <h2>把念头交给道友 AI。</h2>
        <p>从一句话开始，让调研、整理、文档和提醒形成连续结果。</p>
        <div className="dy-cta-row">
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
      </section>
    </main>
  );
}
