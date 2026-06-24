import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FolderKanban,
  GitBranch,
  LockKeyhole,
  NotebookTabs,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "개요", href: "#overview" },
  { label: "PC 위젯", href: "#desktop" },
  { label: "Android", href: "#android" },
  { label: "리뷰", href: "#review" },
  { label: "활용", href: "#fit" },
  { label: "FAQ", href: "#faq" },
];

const quickFacts = ["개인 베타", "PC 위젯 + Android", "소개 전용"];

const reviewSteps = [
  {
    icon: Clock3,
    title: "아침",
    body: "오늘 움직일 작업과 막힌 항목만 먼저 봅니다.",
  },
  {
    icon: FolderKanban,
    title: "진행 중",
    body: "PC 위젯에서 상태를 바꾸고 흐름을 계속 유지합니다.",
  },
  {
    icon: NotebookTabs,
    title: "저녁",
    body: "남은 일과 다음 행동을 짧게 정리합니다.",
  },
];

const faqItems = [
  {
    q: "어떤 문제를 해결하나요?",
    a: "해야 할 일이 여러 화면과 메모에 흩어질 때, 오늘 움직일 항목을 한 곳에서 보고 상태를 바로 바꾸는 데 초점을 둡니다.",
  },
  {
    q: "팀 협업 도구인가요?",
    a: "현재 방향은 개인 작업 흐름에 맞춘 command workspace입니다. 반복적으로 확인해야 하는 개인 일정, 프로젝트, 다음 행동을 빠르게 다루는 경험을 우선합니다.",
  },
  {
    q: "언제 사용할 수 있나요?",
    a: "지금은 제품 경험을 다듬는 단계입니다. 공개 사용 가능 시점과 설치 방식은 준비가 끝나는 대로 이 페이지에서 안내할 예정입니다.",
  },
];

function unregisterLegacyServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    })
    .catch(() => undefined);
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      src="/askewly-command-icon.png"
      alt=""
      className={`inline-flex size-9 rounded-lg shadow-[0_10px_28px_rgb(0_0_0_/_0.22)] ${className}`}
      aria-hidden="true"
    />
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#383838] bg-[#171717]">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <a href="#top" className="flex items-center gap-3" aria-label="Askewly Command 홈">
          <BrandMark />
          <span className="text-[15px] font-bold tracking-normal text-[#F5F5F5]">
            Askewly Command
          </span>
        </a>
        <nav className="hidden items-center gap-7 text-sm font-medium text-[#A3A3A3] md:flex">
          {navItems.slice(1, 5).map((item) => (
            <a key={item.href} href={item.href} className="hover:text-[#F5F5F5]">
              {item.label}
            </a>
          ))}
        </nav>
        <Button asChild size="sm" className="hidden bg-[#D3A13F] text-[#202020] hover:bg-[#e0b65d] sm:inline-flex">
          <a href="#desktop">
            위젯 보기
            <ArrowRight className="size-4" />
          </a>
        </Button>
      </div>
    </header>
  );
}

function SectionNav() {
  return (
    <div className="sticky top-[72px] z-20 -mt-6 px-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl overflow-x-auto">
        <nav className="mx-auto flex w-max min-w-max items-center justify-center gap-1 rounded-full border border-[#383838] bg-[#202020]/95 px-2 py-2 text-sm font-semibold text-[#A3A3A3] shadow-[0_18px_50px_rgb(0_0_0_/_0.35)]">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-4 py-2 hover:bg-[#262626] hover:text-[#F5F5F5]"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="mx-auto mt-12 w-full max-w-5xl rounded-[28px] border border-[#383838] bg-[#202020] p-3 shadow-[0_22px_70px_rgb(0_0_0_/_0.38)] sm:p-4">
      <EmptyPreview className="aspect-[16/10] rounded-[20px]" label="메인 데모 영역" />
    </div>
  );
}

function EmptyPreview({ className = "", label }: { className?: string; label: string }) {
  return (
    <div
      className={`border border-[#383838] bg-[#171717] ${className}`}
      role="img"
      aria-label={label}
    />
  );
}

function MediaFrame({
  title,
  children,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <figure className="rounded-[24px] border border-[#383838] bg-[#202020] p-3 shadow-[0_18px_52px_rgb(0_0_0_/_0.28)]">
      <div className={`overflow-hidden rounded-[18px] border border-[#383838] bg-[#171717] ${compact ? "p-3" : ""}`}>
        {children}
      </div>
      <figcaption className="sr-only">{title}</figcaption>
    </figure>
  );
}

function FeatureSection({
  id,
  label,
  title,
  body,
  points,
  image,
  reverse = false,
}: {
  id: string;
  label: string;
  title: string;
  body: string;
  points: string[];
  image: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-b border-[#383838] bg-[#171717] py-20 sm:py-24">
      <div className={`mx-auto grid max-w-7xl items-center gap-10 px-5 sm:px-6 lg:grid-cols-2 lg:px-8 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className="max-w-xl">
          <p className="mb-4 text-sm font-bold text-[#D3A13F]">{label}</p>
          <h2 className="break-all text-3xl font-black leading-tight text-[#F5F5F5] sm:break-normal sm:text-4xl">
            {title}
          </h2>
          <p className="mt-5 text-base leading-8 text-[#C8C8C8]">{body}</p>
          <ul className="mt-8 space-y-4">
            {points.map((point) => (
              <li key={point} className="flex gap-3 text-sm leading-6 text-[#E6E6E6]">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#D3A13F]" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        {image}
      </div>
    </section>
  );
}

function ReviewSection() {
  return (
    <section id="review" className="scroll-mt-28 border-b border-[#383838] bg-[#202020] py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-bold text-[#D3A13F]">리뷰 루프</p>
          <h2 className="break-all text-3xl font-black leading-tight text-[#F5F5F5] sm:break-normal sm:text-4xl">
            하루 전체를 자동화하지 않고, 판단이 필요한 순간만 남깁니다.
          </h2>
          <p className="mt-5 text-base leading-8 text-[#C8C8C8]">
            Askewly Command는 거창한 대시보드보다 매일 반복되는 결정에 맞춰져 있습니다. 다음 행동, 지연된 일, 보류된 일을 짧게 확인하는 흐름을 우선합니다.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {reviewSteps.map((step) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="rounded-2xl border border-[#383838] bg-[#171717] p-6">
                <Icon className="size-7 text-[#D3A13F]" />
                <h3 className="mt-5 text-xl font-black text-[#F5F5F5]">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#BEBEBE]">{step.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FitSection() {
  return (
    <section id="fit" className="scroll-mt-28 border-b border-[#383838] bg-[#171717] py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <p className="mb-4 text-sm font-bold text-[#D3A13F]">활용 방식</p>
          <h2 className="break-all text-3xl font-black leading-tight text-[#F5F5F5] sm:break-normal sm:text-4xl">
            여러 작업 표면을 하루의 실행 흐름으로 묶습니다.
          </h2>
          <p className="mt-5 text-base leading-8 text-[#C8C8C8]">
            캘린더, 프로젝트, 메모, 진행 상태가 따로 움직일 때 Askewly Command는 오늘 확인해야 할 장면을 짧게 정리해 줍니다.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: ShieldCheck,
              title: "오늘의 우선순위",
              body: "지금 봐야 할 작업과 나중에 봐도 되는 일을 구분합니다.",
            },
            {
              icon: LockKeyhole,
              title: "상태 중심 흐름",
              body: "진행, 보류, 지연 같은 상태를 기준으로 다음 행동을 고릅니다.",
            },
            {
              icon: GitBranch,
              title: "맥락 연결",
              body: "프로젝트와 일정 사이를 오가며 작업의 배경을 놓치지 않게 합니다.",
            },
            {
              icon: CircleHelp,
              title: "가벼운 회고",
              body: "하루가 끝날 때 남은 일과 다음 시작점을 빠르게 정리합니다.",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="rounded-2xl border border-[#383838] bg-[#202020] p-6">
                <Icon className="size-6 text-[#D3A13F]" />
                <h3 className="mt-5 text-lg font-black text-[#F5F5F5]">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#BEBEBE]">{item.body}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-28 bg-[#202020] py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-5 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-black text-[#F5F5F5] sm:text-4xl">FAQ</h2>
        <div className="mt-10 divide-y divide-[#383838] border-y border-[#383838]">
          {faqItems.map((item) => (
            <article key={item.q} className="py-7">
              <h3 className="text-lg font-black text-[#F5F5F5]">{item.q}</h3>
              <p className="mt-3 text-sm leading-7 text-[#BEBEBE]">{item.a}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function App() {
  useEffect(() => {
    unregisterLegacyServiceWorker();
  }, []);

  return (
    <main id="top" className="min-h-screen bg-[#171717] text-[#F5F5F5]">
      <a
        href="#overview"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[#D3A13F] focus:px-4 focus:py-2 focus:text-[#202020]"
      >
        본문으로 이동
      </a>
      <Header />

      <section id="overview" className="scroll-mt-28 border-b border-[#383838] bg-[#171717] px-5 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-8 flex justify-center">
              <BrandMark className="size-14 rounded-2xl text-xl" />
            </div>
            <h1 className="mx-auto max-w-[21rem] text-[2.1rem] font-black leading-tight text-[#F5F5F5] sm:max-w-4xl sm:text-6xl lg:text-7xl">
              <span className="block sm:hidden">열어보지 않아도</span>
              <span className="block sm:hidden">보이는 오늘의</span>
              <span className="block sm:hidden">일정 관리.</span>
              <span className="hidden sm:block">열어보지 않아도 보이는</span>
              <span className="hidden sm:block">오늘의 일정 관리.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-[21rem] text-base leading-8 text-[#C8C8C8] sm:max-w-2xl sm:text-xl">
              <span className="block sm:inline">Windows 위젯이 오늘의 흐름을 계속 보여주고, </span>
              <span className="block sm:inline">모바일 앱이 자리를 옮긴 뒤의 관리를 이어갑니다.</span>
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full bg-[#D3A13F] text-[#202020] hover:bg-[#e0b65d] sm:w-auto">
                <a href="#desktop">
                  위젯 흐름 보기
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full border-[#383838] bg-transparent text-[#F5F5F5] hover:bg-[#262626] sm:w-auto">
                <a href="#android">모바일 연동 보기</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {quickFacts.map((fact) => (
                <Badge key={fact} variant="outline" className="border-[#383838] bg-[#202020] px-3 py-1 text-[#C8C8C8]">
                  {fact}
                </Badge>
              ))}
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      <SectionNav />

      <FeatureSection
        id="desktop"
        label="PC 위젯"
        title="자주 보는 화면에 오늘 할 일을 고정합니다."
        body="우측 세로 모니터에 계속 띄워두는 Electron 위젯입니다. 일정을 다시 찾지 않아도 현재 작업 상태와 다음 행동을 바로 확인할 수 있습니다."
        points={["업무 중 계속 보이는 상시 화면", "보류, 지연, 진행 중 상태를 같은 맥락에서 확인", "개인 작업 흐름에 맞춘 어두운 위젯 UI"]}
        image={
          <MediaFrame title="Desktop widget">
            <EmptyPreview className="aspect-[4/3]" label="PC 위젯 데모 영역" />
          </MediaFrame>
        }
      />

      <FeatureSection
        id="android"
        label="Android 앱"
        title="밖에서는 Android 앱으로 상태만 빠르게 바꿉니다."
        body="모바일 앱은 같은 작업 상태를 가볍게 확인하고 바꾸는 표면입니다. 이동 중에는 전체 계획보다 오늘 필요한 상태 변경에 집중합니다."
        points={["Expo 기반 Android 앱", "PC와 같은 작업 상태를 확인", "작은 화면에서는 핵심 정보만 먼저 표시"]}
        reverse
        image={
          <MediaFrame title="Android build" compact>
            <EmptyPreview className="mx-auto aspect-[9/16] w-full max-w-[360px]" label="Android 앱 데모 영역" />
          </MediaFrame>
        }
      />

      <ReviewSection />
      <FitSection />
      <FaqSection />

      <footer className="border-t border-[#383838] bg-[#171717] px-5 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-[#A3A3A3] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark className="size-8 rounded-md text-xs" />
            <span>Askewly Command</span>
          </div>
          <span>Public landing for the personal command workspace.</span>
        </div>
      </footer>
    </main>
  );
}

export default App;
