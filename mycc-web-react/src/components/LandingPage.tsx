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

const scenes = [
  {
    label: "周报",
    title: "周报与汇报文档",
    image: `${assetBase}/scene-weekly-report.jpg`,
    alt: "道友 AI 周报生成场景",
    body: "把零散进展整理成老板能看的版本，风险、计划和不同口径一次生成。",
    Icon: DocumentTextIcon,
  },
  {
    label: "调研",
    title: "网页调研与结论报告",
    image: `${assetBase}/scene-web-research.jpg`,
    alt: "道友 AI 网页调研场景",
    body: "抓取网页资料，分析竞品痛点，识别未满足需求和购买决策因素。",
    Icon: MagnifyingGlassIcon,
  },
  {
    label: "整理",
    title: "资料整理与成果包",
    image: `${assetBase}/scene-file-organize.jpg`,
    alt: "道友 AI 资料整理场景",
    body: "文件、链接、截图和表格不再散落，整理成可继续编辑的成果空间。",
    Icon: FolderOpenIcon,
  },
  {
    label: "跟进",
    title: "会议后续与自动跟进",
    image: `${assetBase}/scene-follow-up.jpg`,
    alt: "道友 AI 自动跟进场景",
    body: "会议后的待办、周期巡检、订阅提醒和后续动作，到时间继续推进。",
    Icon: BellAlertIcon,
  },
];

export function LandingPage() {
  const primaryScene = scenes[1];
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
            gsap.set(".dy-reveal, .dy-hero-motion", {
              autoAlpha: 1,
              clearProps: "transform,visibility,opacity",
            });
            return;
          }

          const heroTimeline = gsap.timeline({
            defaults: { ease: "power3.out", duration: 0.9 },
          });

          heroTimeline
            .from(".dy-header", { autoAlpha: 0, y: -18, duration: 0.55 })
            .from(
              ".dy-hero-title-line",
              {
                autoAlpha: 0,
                y: 52,
                stagger: 0.08,
              },
              "-=0.18",
            )
            .from(
              ".dy-hero-subtitle",
              { autoAlpha: 0, y: 24, duration: 0.72 },
              "-=0.5",
            )
            .from(
              ".dy-cta",
              {
                autoAlpha: 0,
                y: 20,
                stagger: 0.08,
                duration: 0.62,
              },
              "-=0.42",
            )
            .from(
              ".dy-hero-visual",
              { autoAlpha: 0, y: 56, scale: 0.98, duration: 1 },
              "-=0.44",
            );

          gsap.to(".dy-hero-visual img", {
            yPercent: isDesktop ? -8 : -4,
            scale: 1.035,
            ease: "none",
            scrollTrigger: {
              trigger: ".dy-hero",
              start: "top top",
              end: "bottom top",
              scrub: 0.8,
            },
          });

          gsap.set(".dy-reveal", { autoAlpha: 0, y: 42 });
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
          --dy-bg: #090a0b;
          --dy-bg-soft: #10131a;
          --dy-paper: #f6f7fb;
          --dy-ink: #10131a;
          --dy-muted: #687083;
          --dy-line: rgba(255, 255, 255, 0.13);
          --dy-accent: #8b7cff;
          min-height: 100dvh;
          background: var(--dy-bg);
          color: #fff;
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
          text-decoration: none;
        }

        .dy-header {
          position: fixed;
          inset: 0 0 auto;
          z-index: 20;
          height: 72px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(9, 10, 11, 0.74);
          backdrop-filter: blur(18px);
        }

        .dy-header-inner,
        .dy-wide {
          width: min(1200px, calc(100% - 48px));
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
          font-weight: 780;
          letter-spacing: 0;
          white-space: nowrap;
        }

        .dy-brand-mark,
        .dy-cta-icon {
          display: grid;
          place-items: center;
          flex: none;
        }

        .dy-brand-mark {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent 34%),
            linear-gradient(135deg, #8b7cff, #78a4ff 58%, #66eadf);
          color: #fff;
          box-shadow: 0 0 34px rgba(120, 164, 255, 0.32);
          font-size: 18px;
          font-weight: 900;
        }

        .dy-nav {
          display: flex;
          align-items: center;
          gap: 26px;
          color: rgba(255, 255, 255, 0.66);
          font-size: 14px;
          font-weight: 560;
          white-space: nowrap;
        }

        .dy-actions {
          display: flex;
          align-items: center;
          gap: 16px;
          color: rgba(255, 255, 255, 0.72);
          font-size: 14px;
          font-weight: 650;
          white-space: nowrap;
        }

        .dy-landing .dy-header-button {
          border-radius: 999px;
          background: #fff;
          color: var(--dy-ink);
          padding: 9px 17px;
          font-weight: 760;
        }

        .dy-hero {
          position: relative;
          overflow: hidden;
          min-height: 100dvh;
          padding: 124px 24px 74px;
          text-align: center;
          background:
            radial-gradient(circle at 50% 24%, rgba(139, 124, 255, 0.27), transparent 330px),
            radial-gradient(circle at 50% 66%, rgba(102, 234, 223, 0.1), transparent 360px),
            var(--dy-bg);
        }

        .dy-hero::before {
          content: "";
          position: absolute;
          left: 50%;
          top: 96px;
          width: 960px;
          height: 480px;
          transform: translateX(-50%);
          background: repeating-radial-gradient(
            ellipse at center,
            rgba(255, 255, 255, 0.15) 0 1px,
            transparent 1px 24px
          );
          opacity: 0.36;
          mask-image: radial-gradient(ellipse at center, black 0%, transparent 72%);
          pointer-events: none;
        }

        .dy-hero-content {
          position: relative;
          z-index: 1;
          max-width: 1040px;
          margin: 0 auto;
        }

        .dy-hero h1 {
          margin: 0;
          font-size: clamp(52px, 7.5vw, 104px);
          line-height: 0.96;
          letter-spacing: 0;
          font-weight: 880;
        }

        .dy-nowrap {
          display: inline-block;
          white-space: nowrap;
        }

        .dy-hero-motion,
        .dy-reveal,
        .dy-hero-visual,
        .dy-hero-visual img {
          will-change: transform, opacity;
        }

        .dy-hero-subtitle {
          max-width: 760px;
          margin: 26px auto 0;
          color: rgba(255, 255, 255, 0.72);
          font-size: clamp(18px, 2vw, 23px);
          line-height: 1.62;
        }

        .dy-cta-row {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 36px;
        }

        .dy-cta {
          width: 218px;
          min-height: 62px;
          display: flex;
          align-items: center;
          gap: 13px;
          border-radius: 16px;
          padding: 12px 16px;
          text-align: left;
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

        .dy-landing .dy-cta-primary {
          background: #fff;
          color: #111827;
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        }

        .dy-landing .dy-cta-secondary {
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }

        .dy-cta-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: #111827;
          color: #fff;
          font-size: 13px;
          font-weight: 900;
        }

        .dy-cta-secondary .dy-cta-icon {
          background: #fff;
          color: #111827;
        }

        .dy-cta-title,
        .dy-cta-desc {
          display: block;
        }

        .dy-cta-title {
          font-size: 15px;
          font-weight: 830;
          line-height: 1.1;
        }

        .dy-cta-desc {
          margin-top: 4px;
          color: #667085;
          font-size: 12px;
          font-weight: 620;
        }

        .dy-cta-secondary .dy-cta-desc {
          color: rgba(255, 255, 255, 0.58);
        }

        .dy-hero-visual {
          position: relative;
          z-index: 1;
          width: min(900px, calc(100vw - 48px));
          margin: 64px auto 0;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 34px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.05);
          box-shadow:
            0 46px 140px rgba(0, 0, 0, 0.46),
            inset 0 1px rgba(255, 255, 255, 0.16);
        }

        .dy-hero-visual img,
        .dy-scene-image img,
        .dy-feature img {
          display: block;
          width: 100%;
          object-fit: cover;
        }

        .dy-hero-visual img {
          aspect-ratio: 16 / 9;
        }

        .dy-statement {
          background: var(--dy-paper);
          color: var(--dy-ink);
          padding: 104px 24px 96px;
          text-align: center;
        }

        .dy-decorative-line {
          width: min(420px, 72vw);
          height: 28px;
          margin: 0 auto 34px;
          border-radius: 999px;
          background:
            linear-gradient(90deg, transparent, rgba(139, 124, 255, 0.26), transparent),
            repeating-linear-gradient(90deg, transparent 0 22px, rgba(16, 19, 26, 0.1) 22px 23px);
          opacity: 0.75;
        }

        .dy-statement h2,
        .dy-feature-block h2,
        .dy-daily h2,
        .dy-final h2 {
          margin: 0 auto;
          font-size: clamp(42px, 6vw, 78px);
          line-height: 1.06;
          letter-spacing: 0;
          font-weight: 880;
        }

        .dy-statement h2 {
          max-width: 1100px;
        }

        .dy-inline-token {
          display: inline-grid;
          place-items: center;
          width: 0.9em;
          height: 0.9em;
          margin: 0 0.08em;
          border-radius: 0.25em;
          vertical-align: -0.09em;
          background: #fff;
          color: var(--dy-accent);
          box-shadow: 0 12px 28px rgba(16, 24, 40, 0.12);
          font-size: 0.43em;
          letter-spacing: 0;
          font-weight: 900;
        }

        .dy-statement p,
        .dy-daily p,
        .dy-final p {
          max-width: 620px;
          margin: 26px auto 0;
          font-size: 19px;
          line-height: 1.72;
        }

        .dy-statement p {
          color: var(--dy-muted);
        }

        .dy-scenes,
        .dy-daily,
        .dy-final {
          background: var(--dy-bg);
        }

        .dy-scenes {
          padding: 88px 24px 104px;
        }

        .dy-tabs {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 30px;
        }

        .dy-tab {
          min-width: 112px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.045);
          padding: 11px 18px;
          color: rgba(255, 255, 255, 0.62);
          text-align: center;
          font-size: 14px;
          font-weight: 760;
        }

        .dy-tab-active {
          background: #fff;
          color: #12151d;
        }

        .dy-scene-card {
          display: grid;
          grid-template-columns: 0.85fr 1.15fr;
          gap: 28px;
          min-height: 520px;
          border: 1px solid rgba(255, 255, 255, 0.13);
          border-radius: 34px;
          background:
            radial-gradient(circle at 88% 16%, rgba(139, 124, 255, 0.18), transparent 360px),
            linear-gradient(135deg, #141822 0%, #090b10 100%);
          box-shadow: 0 44px 130px rgba(0, 0, 0, 0.36);
          padding: 30px;
        }

        .dy-scene-copy {
          align-self: center;
          padding: 18px;
        }

        .dy-efficiency {
          display: inline-flex;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          padding: 8px 12px;
          color: rgba(255, 255, 255, 0.72);
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 22px;
        }

        .dy-scene-copy h3 {
          margin: 0;
          font-size: clamp(34px, 4.2vw, 60px);
          line-height: 1.02;
          letter-spacing: 0;
          font-weight: 860;
        }

        .dy-scene-copy p {
          margin: 20px 0 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 17px;
          line-height: 1.72;
        }

        .dy-compare {
          display: grid;
          gap: 12px;
          margin-top: 28px;
        }

        .dy-compare-block {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.06);
          padding: 15px;
        }

        .dy-compare-block strong {
          display: block;
          margin-bottom: 6px;
          color: rgba(255, 255, 255, 0.88);
          font-size: 13px;
        }

        .dy-compare-block span {
          color: rgba(255, 255, 255, 0.58);
          font-size: 13px;
          line-height: 1.55;
        }

        .dy-scene-image {
          align-self: stretch;
          min-height: 430px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 28px;
          overflow: hidden;
          background: #111827;
        }

        .dy-scene-image img {
          height: 100%;
        }

        .dy-feature-block {
          background: var(--dy-paper);
          color: var(--dy-ink);
          padding: 104px 24px;
        }

        .dy-feature-block h2 {
          max-width: 900px;
          margin-bottom: 48px;
          text-align: center;
        }

        .dy-feature-grid {
          max-width: 1180px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .dy-feature {
          min-height: 430px;
          border: 1px solid #e1e7f0;
          border-radius: 32px;
          background: #fff;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(16, 24, 40, 0.08);
        }

        .dy-feature img {
          height: 260px;
          background: #111827;
        }

        .dy-feature-body {
          padding: 24px;
        }

        .dy-feature-heading {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }

        .dy-feature-icon {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: #f0f3ff;
          color: #6f63e8;
          flex: none;
        }

        .dy-feature-icon svg {
          width: 20px;
          height: 20px;
        }

        .dy-feature h3 {
          margin: 0;
          font-size: 26px;
          line-height: 1.08;
          letter-spacing: 0;
          font-weight: 860;
        }

        .dy-feature p {
          margin: 0;
          color: #667085;
          font-size: 15px;
          line-height: 1.66;
        }

        .dy-daily {
          padding: 104px 24px;
          text-align: center;
        }

        .dy-daily h2,
        .dy-final h2 {
          max-width: 860px;
        }

        .dy-daily p,
        .dy-final p {
          color: rgba(255, 255, 255, 0.68);
        }

        .dy-daily-list {
          max-width: 980px;
          margin: 44px auto 0;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          text-align: left;
        }

        .dy-daily-item {
          border: 1px solid rgba(255, 255, 255, 0.13);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.06);
          padding: 22px;
        }

        .dy-daily-item h3 {
          margin: 0 0 8px;
          font-size: 20px;
          letter-spacing: 0;
        }

        .dy-daily-item span {
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
          line-height: 1.58;
        }

        .dy-final {
          padding: 104px 24px 112px;
          text-align: center;
          background:
            radial-gradient(circle at 50% 20%, rgba(139, 124, 255, 0.2), transparent 340px),
            var(--dy-bg);
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
            padding-top: 118px;
          }
          .dy-scene-card,
          .dy-feature-grid,
          .dy-daily-list {
            grid-template-columns: 1fr;
          }
          .dy-scene-image {
            min-height: 320px;
          }
        }

        @media (max-width: 640px) {
          .dy-header {
            height: 66px;
          }
          .dy-header-inner,
          .dy-wide {
            width: min(100% - 32px, 1200px);
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
            padding: 106px 16px 56px;
          }
          .dy-hero h1 {
            font-size: clamp(44px, 15vw, 62px);
          }
          .dy-hero-subtitle {
            font-size: 17px;
          }
          .dy-cta {
            width: min(100%, 260px);
          }
          .dy-hero-visual {
            width: 100%;
            margin-top: 46px;
            border-radius: 24px;
          }
          .dy-statement,
          .dy-scenes,
          .dy-feature-block,
          .dy-daily,
          .dy-final {
            padding-left: 16px;
            padding-right: 16px;
          }
          .dy-statement h2,
          .dy-feature-block h2,
          .dy-daily h2,
          .dy-final h2 {
            font-size: clamp(36px, 11vw, 48px);
            letter-spacing: 0;
          }
          .dy-scene-card {
            padding: 18px;
            border-radius: 26px;
          }
          .dy-scene-copy {
            padding: 6px;
          }
          .dy-feature,
          .dy-daily-item {
            border-radius: 22px;
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
            <a href="#scenes">场景</a>
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
        <div className="dy-hero-content">
          <h1 className="dy-hero-motion" aria-label="随心而动，念头通达">
            <span className="dy-nowrap dy-hero-title-line">随心而动，</span>
            <span className="dy-nowrap dy-hero-title-line">念头通达</span>
          </h1>
          <p className="dy-hero-subtitle">
            将道友 AI
            的智能体能力延展到日常工作场景。描述需求，自动执行，直接交付结果。
          </p>
          <div className="dy-cta-row">
            <a className="dy-cta dy-cta-primary" href="/login">
              <span className="dy-cta-icon" aria-hidden="true">
                道
              </span>
              <span>
                <span className="dy-cta-title">开始使用</span>
                <span className="dy-cta-desc">进入工作空间</span>
              </span>
            </a>
            <a className="dy-cta dy-cta-secondary" href="#scenes">
              <span className="dy-cta-icon" aria-hidden="true">
                <ArrowRightIcon width={17} height={17} strokeWidth={2.4} />
              </span>
              <span>
                <span className="dy-cta-title">查看场景</span>
                <span className="dy-cta-desc">周报 / 调研 / 整理 / 跟进</span>
              </span>
            </a>
          </div>
          <div className="dy-hero-visual">
            <img
              src={`${assetBase}/scene-weekly-report.jpg`}
              alt="道友 AI 桌面工作场景"
            />
          </div>
        </div>
      </section>

      <section className="dy-statement dy-reveal">
        <div className="dy-decorative-line" aria-hidden="true" />
        <h2>
          通过会话，完成资料整理、
          <span className="dy-inline-token">PDF</span>
          网页调研
          <span className="dy-inline-token">表</span>
          与文档生成。
        </h2>
        <p>为日常工作而生的 AI 效率工具。说出你想做的就好。</p>
      </section>

      <section className="dy-scenes" id="scenes">
        <div className="dy-wide">
          <div className="dy-tabs dy-reveal" aria-label="工作场景">
            {scenes.map((scene) => (
              <span
                className={`dy-tab ${
                  scene.label === primaryScene.label ? "dy-tab-active" : ""
                }`}
                key={scene.label}
              >
                {scene.label}
              </span>
            ))}
          </div>
          <div className="dy-scene-card dy-reveal">
            <div className="dy-scene-copy">
              <div className="dy-efficiency">
                效率提升：1 到 2 天 -&gt; 11 分钟
              </div>
              <h3>{primaryScene.title}</h3>
              <p>{primaryScene.body}</p>
              <div className="dy-compare">
                <div className="dy-compare-block">
                  <strong>传统痛点：</strong>
                  <span>手动搜索、逐页阅读，数据碎片化，难以结构化。</span>
                </div>
                <div className="dy-compare-block">
                  <strong>道友方案：</strong>
                  <span>自动浏览网页、提取重点，输出结构化洞察报告。</span>
                </div>
              </div>
            </div>
            <div className="dy-scene-image">
              <img src={primaryScene.image} alt={primaryScene.alt} />
            </div>
          </div>
        </div>
      </section>

      <section className="dy-feature-block">
        <h2>说出想法，自动完成，直接交付。</h2>
        <div className="dy-feature-grid">
          {scenes.map(({ Icon, ...scene }) => (
            <article className="dy-feature dy-reveal" key={scene.label}>
              <img src={scene.image} alt={scene.alt} />
              <div className="dy-feature-body">
                <div className="dy-feature-heading">
                  <span className="dy-feature-icon" aria-hidden="true">
                    <Icon strokeWidth={1.8} />
                  </span>
                  <h3>{scene.title}</h3>
                </div>
                <p>{scene.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="dy-daily" id="daily">
        <h2>专为日常工作打造</h2>
        <p>本地资料、网页阅读、文档成果和后续提醒，都放进一个连续的工作流。</p>
        <div className="dy-daily-list">
          <div className="dy-daily-item dy-reveal">
            <h3>本地资料直接使用</h3>
            <span>授权文件夹即可作为工作场景，结果自动保存。</span>
          </div>
          <div className="dy-daily-item dy-reveal">
            <h3>自主规划并执行</h3>
            <span>自动拆解任务，逐步推进，过程可见。</span>
          </div>
          <div className="dy-daily-item dy-reveal">
            <h3>安全、透明、可控</h3>
            <span>关键动作前确认，执行记录可以回看。</span>
          </div>
        </div>
      </section>

      <section className="dy-final dy-reveal">
        <h2>桌面级通用智能体助手</h2>
        <p>从一个念头开始，把资料、网页、文档和跟进串成可交付的结果。</p>
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
