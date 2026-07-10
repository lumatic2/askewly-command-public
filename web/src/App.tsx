import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Command,
  FolderKanban,
  GitBranch,
  LockKeyhole,
  NotebookTabs,
  RefreshCw,
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

const quickFacts = ["개인용 도구", "PC 위젯 + Android", "Google Workspace 기반"];

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
    q: "데이터는 어디에 있나요?",
    a: "할 일은 Google Tasks, 시간 일정과 마감은 Google Calendar, 프로젝트 카탈로그는 Google Sheets에 있습니다. 자체 서버 없이 위젯·모바일 앱·CLI가 같은 Google Workspace 데이터를 직접 읽고 씁니다. AI 에이전트도 검증된 CLI 명령으로 같은 데이터를 조작합니다.",
  },
  {
    q: "팀 협업 도구인가요? 설치할 수 있나요?",
    a: "아니요. 제작자 개인의 작업 흐름에 맞춘 1인용 command workspace이며, 스토어 배포나 외부 설치 계획이 없습니다. 이 페이지는 실제로 매일 쓰는 개인 도구를 소개하는 포트폴리오 성격의 공개면입니다.",
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
      <div className="grid gap-3 rounded-[20px] border border-[#383838] bg-[#171717] p-3 md:grid-cols-[1.35fr_0.65fr]">
        <DesktopWidgetPreview compact />
        <MobileCommandPreview compact />
      </div>
    </div>
  );
}

function PreviewShell({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={`border border-[#383838] bg-[#111111] ${className}`} role="img" aria-label={label}>
      {children}
    </div>
  );
}

const desktopTasks = [
  "오늘 인터뷰 질문 정리",
  "웹 공개 페이지 캡처 교체",
  "프로젝트 메타데이터 확인",
  "마감 전 제출 파일 점검",
];

function DesktopWidgetPreview({ compact = false }: { compact?: boolean }) {
  return (
    <PreviewShell
      label="Askewly Command PC 위젯 실제 구조 미리보기"
      className={`overflow-hidden rounded-[18px] ${compact ? "min-h-[310px]" : "aspect-[4/3]"}`}
    >
      <div className="flex h-full min-h-[310px] bg-[#101114] text-[#EDEDED]">
        <aside className="flex w-[84px] shrink-0 flex-col gap-3 border-r border-[#2D2D2D] bg-[#17181D] p-3 text-[11px] font-bold text-[#8F929B]">
          <div className="mb-2 flex items-center gap-2 text-left text-sm text-[#F5F5F5]">
            <span className="size-2 rounded-full bg-[#D3A13F]" />
            <span className={compact ? "sr-only" : ""}>Dashboard</span>
          </div>
          {["오늘", "달력", "프로젝트"].map((item) => (
            <div
              key={item}
              className={`rounded-lg px-2 py-3 text-center ${item === "오늘" ? "bg-[#33291A] text-[#D3A13F] ring-1 ring-[#D3A13F]" : ""}`}
            >
              {item}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 bg-[#141414]">
          <div className="flex items-center justify-between border-b border-[#2D2D2D] px-4 py-3">
            <div className="text-[12px] font-black uppercase tracking-[0.08em] text-[#A3A3A3]">오늘</div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-[#343434] px-2 py-1 text-[11px] font-bold text-[#D3A13F]">+ Add</span>
              <RefreshCw className="size-4 text-[#8F929B]" />
            </div>
          </div>
          <div className="grid gap-0 md:grid-cols-2">
            <section className="border-b border-[#2D2D2D] bg-[#241F18] p-4 md:border-r">
              <div className="mb-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#8FA0B8]">TODAY 할 일 4</div>
              <div className="space-y-3">
                {desktopTasks.slice(0, compact ? 3 : 4).map((task, index) => (
                  <div key={task} className="flex items-start gap-3 border-b border-[#38332A] pb-3 last:border-b-0">
                    <span className={`mt-1 size-4 rounded-full border ${index < 2 ? "border-[#5FC9B6] bg-[#173631]" : "border-[#545454]"}`} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[#F2F2F2]">{task}</div>
                      {index === 1 ? <div className="mt-1 text-xs text-[#9B8A62]">진행 중 · 자료 연결됨</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="border-b border-[#2D2D2D] p-4">
              <div className="mb-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#8FA0B8]">일정</div>
              <div className="space-y-3">
                {[
                  { time: "종일", title: "D-1 지원 마감" },
                  { time: "19:00", title: "온라인 미팅" },
                ].map((event) => (
                  <div key={event.title} className="flex items-center gap-3 rounded-lg border border-[#2D2D2D] bg-[#171717] px-3 py-2">
                    <span className="shrink-0 text-[11px] font-black text-[#D3A13F]">{event.time}</span>
                    <span className="truncate text-sm font-bold text-[#F2F2F2]">{event.title}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="p-4 md:col-span-2">
              <div className="mb-3 text-[11px] font-black uppercase tracking-[0.08em] text-[#8FA0B8]">프로젝트</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {["Askewly Command", "Knowledge Graph", "Toolshelf"].map((label) => (
                  <div key={label} className="rounded-xl border border-[#2D2D2D] bg-[#1D1D1D] p-3">
                    <div className="text-[11px] font-black uppercase text-[#D3A13F]">Pinned</div>
                    <div className="mt-2 truncate text-sm font-black text-[#F5F5F5]">{label}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </PreviewShell>
  );
}

function MobileCommandPreview({ compact = false }: { compact?: boolean }) {
  return (
    <PreviewShell
      label="Askewly Command Android 앱 실제 구조 미리보기"
      className={`mx-auto overflow-hidden rounded-[28px] ${compact ? "h-full min-h-[310px] max-w-[300px]" : "aspect-[9/16] w-full max-w-[360px]"}`}
    >
      <div className="flex h-full min-h-[520px] flex-col bg-[#171717] p-5 text-[#F5F5F5]">
        <div className="flex items-center justify-between text-xs font-bold text-[#A3A3A3]">
          <span>Askewly Command</span>
          <RefreshCw className="size-4" />
        </div>
        <h3 className="mt-5 text-3xl font-black leading-none">오늘</h3>
        <p className="mt-2 text-sm font-bold text-[#BEBEBE]">오늘의 일정과 할 일</p>
        <div className="mt-5 flex gap-2">
          {["일정 3", "할 일 4", "프로젝트 2"].map((item) => (
            <span key={item} className="rounded-lg border border-[#383838] px-3 py-2 text-xs font-black text-[#DADADA]">
              {item}
            </span>
          ))}
        </div>
        <section className="mt-5 rounded-2xl border border-[#383838] bg-[#202020] p-4">
          <div className="text-sm font-black text-[#D3A13F]">일정</div>
          <div className="mt-4 space-y-3 text-sm">
            {[
              { time: "종일", title: "D-1 지원 마감" },
              { time: "19:00", title: "온라인 미팅" },
            ].map((event) => (
              <div key={event.title} className="flex items-center gap-3">
                <span className="shrink-0 text-xs font-black text-[#D3A13F]">{event.time}</span>
                <span className="truncate font-black">{event.title}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-4 rounded-2xl border border-[#383838] bg-[#202020] p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xl font-black">TODAY 할 일</h4>
            <span className="rounded-xl border border-[#383838] px-3 py-2 text-sm font-black">4</span>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            {["공개 페이지 캡처 교체", "인터뷰 질문 정리", "제출 파일 점검"].map((item, index) => (
              <div key={item} className="flex items-center gap-3">
                <span className={`size-4 shrink-0 rounded-full border ${index === 0 ? "border-[#5FC9B6] bg-[#173631]" : "border-[#545454]"}`} />
                <span className="truncate font-black">{item}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="mt-auto grid grid-cols-4 gap-2 border-t border-[#383838] pt-4 text-center text-[11px] font-black text-[#9A9A9A]">
          {["오늘", "달력", "백로그", "프로젝트"].map((item) => (
            <div key={item} className={item === "오늘" ? "text-[#D3A13F]" : ""}>
              <Command className="mx-auto mb-1 size-5" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
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
  image: ReactNode;
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
            <DesktopWidgetPreview />
          </MediaFrame>
        }
      />

      <FeatureSection
        id="android"
        label="Android 앱"
        title="밖에서는 Android 앱으로 상태만 빠르게 바꿉니다."
        body="모바일 앱은 같은 작업 상태를 가볍게 확인하고 바꾸는 표면입니다. 이동 중에는 전체 계획보다 오늘 필요한 상태 변경에 집중합니다."
        points={["Expo 기반 Android 앱", "Google 계정으로 로그인해 PC 위젯과 같은 데이터를 확인", "작은 화면에서는 핵심 정보만 먼저 표시"]}
        reverse
        image={
          <MediaFrame title="Android build" compact>
            <MobileCommandPreview />
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
