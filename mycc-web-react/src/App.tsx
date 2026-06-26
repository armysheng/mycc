import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { SettingsProvider } from "./contexts/SettingsContext";
import { useAuth } from "./contexts/AuthContext";
import {
  clearOnboardingBootstrapPendingIfInitialized,
  getOnboardingBootstrapPending,
  setOnboardingBootstrapPending,
  subscribeOnboardingBootstrapPending,
} from "./utils/onboardingBootstrapState";
import { PRODUCT_COPY } from "./utils/productCopy";

const ChatPage = lazy(() =>
  import("./components/ChatPage").then((module) => ({
    default: module.ChatPage,
  })),
);
const LoginPage = lazy(() =>
  import("./components/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const SkillsPage = lazy(() =>
  import("./components/SkillsPage").then((module) => ({
    default: module.SkillsPage,
  })),
);
const AutomationsPage = lazy(() =>
  import("./components/AutomationsPage").then((module) => ({
    default: module.AutomationsPage,
  })),
);
const WorkspacePage = lazy(() =>
  import("./components/WorkspacePage").then((module) => ({
    default: module.WorkspacePage,
  })),
);

function PageLoading() {
  return <div>{PRODUCT_COPY.resultsSpace}加载中...</div>;
}

function App() {
  const { user, refreshUser, isLoading } = useAuth();
  const [onboardingBootstrapPending, setOnboardingBootstrapPendingState] =
    useState(getOnboardingBootstrapPending());

  useEffect(() => {
    return subscribeOnboardingBootstrapPending((pending) => {
      setOnboardingBootstrapPendingState(pending);
    });
  }, []);

  useEffect(() => {
    clearOnboardingBootstrapPendingIfInitialized(user);
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        加载中...
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<PageLoading />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <SettingsProvider>
      <Router>
        {user.is_initialized === false && !onboardingBootstrapPending && (
          <OnboardingOverlay
            onComplete={async () => {
              setOnboardingBootstrapPending(true);
              try {
                await refreshUser();
              } catch (err) {
                console.error(
                  "[Onboarding] refreshUser failed after initialize:",
                  err,
                );
              }
            }}
          />
        )}
        <Routes>
          {/* 多用户模式：直接进入聊天界面 */}
          <Route
            path="/"
            element={
              <Suspense fallback={<PageLoading />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/projects/*"
            element={
              <Suspense fallback={<PageLoading />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/skills"
            element={
              <Suspense fallback={<PageLoading />}>
                <SkillsPage />
              </Suspense>
            }
          />
          <Route
            path="/automations"
            element={
              <Suspense fallback={<PageLoading />}>
                <AutomationsPage />
              </Suspense>
            }
          />
          <Route
            path="/workspace"
            element={
              <Suspense fallback={<PageLoading />}>
                <WorkspacePage />
              </Suspense>
            }
          />
        </Routes>
      </Router>
    </SettingsProvider>
  );
}

export default App;
