"use client";
// Lazy shell registration. Every shell registers its METADATA eagerly here — so
// resolveShell() + the shell switcher work at startup — but its COMPONENT is
// React.lazy, so each becomes its own chunk: a phone never downloads the desktop
// chrome it cannot reach, and a desktop never downloads the phone chrome.
//
// macOS + iOS used to be EAGER, registered inside desktop.tsx because DesktopChrome
// shared that module with Surface. The measured cost of that convenience was one
// 267 KB first-load chunk carrying BOTH chromes plus every shell feature to every
// visitor. DesktopChrome now lives in components/shells/macos/, so all five split
// the same way. Surface wraps the shell in <Suspense fallback={null}> and paints
// the wallpaper outside it, so the pre-chrome frame shows the themed background —
// the same trade the post-mount render already makes for hydration correctness.
import { lazy } from "react";
import { AppWindow, Bot, Activity, Monitor, Smartphone } from "lucide-react";
import { registerShell } from "./shells";

registerShell({
  id: "macos",
  label: "macOS",
  icon: Monitor,
  surface: "desktop",
  group: "Desktop",
  windowed: true,
  wallpaper: "aurora",
  render: lazy(() => import("../components/shells/macos/macos-shell").then((m) => ({ default: m.DesktopChrome }))),
});
registerShell({
  id: "ios",
  label: "iOS",
  icon: Smartphone,
  surface: "mobile",
  group: "Mobile",
  wallpaper: "ios",
  render: lazy(() => import("../components/mobile-shell").then((m) => ({ default: m.MobileShell }))),
});

registerShell({
  id: "windows",
  label: "Windows",
  icon: AppWindow,
  surface: "desktop",
  group: "Desktop",
  windowed: true,
  wallpaper: "win11",
  render: lazy(() => import("../components/shells/windows/windows-shell").then((m) => ({ default: m.WindowsShell }))),
});
registerShell({
  id: "android",
  label: "Android",
  icon: Bot,
  surface: "mobile",
  group: "Mobile",
  wallpaper: "material",
  render: lazy(() => import("../components/shells/android/android-shell").then((m) => ({ default: m.AndroidShell }))),
});
registerShell({
  id: "dashboard",
  label: "Dashboard",
  icon: Activity,
  surface: "desktop",
  group: "Desktop",
  wallpaper: "graphite",
  render: lazy(() => import("../components/shells/dashboard/dashboard-shell").then((m) => ({ default: m.DashboardShell }))),
});
