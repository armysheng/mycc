import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import { ChatPage } from "./components/ChatPage";
import { LoginPage } from "./components/LoginPage";
import { SkillsPage } from "./components/SkillsPage";
import { AutomationsPage } from "./components/AutomationsPage";
import { WorkspacePage } from "./components/WorkspacePage";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { SettingsProvider } from "./contexts/SettingsContext";
import { useAuth } from "./contexts/AuthContext";
import { isDevelopment } from "./utils/environment";

// Lazy load DemoPage only in development
const DemoPage = isDevelopment()
  ? lazy(() =>
      import("./components/DemoPage").then((module) => ({
        default: module.DemoPage,
      })),
    )
  : null;

function App() {
  const { user, refreshUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        加载中...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <SettingsProvider>
      <Router>
        {user.is_initialized === false && (
          <OnboardingOverlay
            onComplete={refreshUser}
            userNickname={user.nickname}
          />
        )}
        <Routes>
          {/* 多用户模式：直接进入聊天界面 */}
          <Route path="/" element={<ChatPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          {DemoPage && (
            <Route
              path="/demo"
              element={
                <Suspense fallback={<div>Loading demo...</div>}>
                  <DemoPage />
                </Suspense>
              }
            />
          )}
        </Routes>
      </Router>
    </SettingsProvider>
  );
}

export default App;
