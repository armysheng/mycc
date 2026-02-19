import { useEffect, useCallback, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import type {
  ChatRequest,
  ChatMessage,
  PermissionMode,
} from "../types";
import { useClaudeStreaming } from "../hooks/useClaudeStreaming";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useAbortController } from "../hooks/chat/useAbortController";
import { useAutoHistoryLoader } from "../hooks/useHistoryLoader";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { HistoryButton } from "./chat/HistoryButton";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { HistoryView } from "./HistoryView";
import { Sidebar } from "./layout/Sidebar";
import { RightPanel } from "./layout/RightPanel";
import { getChatUrl, getAuthHeaders } from "../config/api";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";
import { useAuth } from "../contexts/AuthContext";

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const { token } = useAuth();

  // Extract and normalize working directory from URL
  const workingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath) return undefined;

    // URL decode the path
    const decodedPath = decodeURIComponent(rawPath);

    // Normalize Windows paths (remove leading slash from /C:/... format)
    return normalizeWindowsPath(decodedPath);
  })();

  // Get current view and sessionId from query parameters
  const currentView = searchParams.get("view");
  const sessionId = searchParams.get("sessionId");
  const isHistoryView = currentView === "history";
  const isLoadedConversation = !!sessionId && !isHistoryView;

  const { processStreamLine } = useClaudeStreaming();
  const { abortRequest, createAbortHandler } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
    sessionId: loadedSessionId,
  } = useAutoHistoryLoader(sessionId || undefined);

  // Initialize chat state with loaded history
  const {
    messages,
    input,
    isLoading,
    currentSessionId,
    currentRequestId,
    hasShownInitMessage,
    currentAssistantMessage,
    setInput,
    setCurrentSessionId,
    setHasShownInitMessage,
    setHasReceivedInit,
    setCurrentAssistantMessage,
    addMessage,
    updateLastMessage,
    clearInput,
    generateRequestId,
    resetRequestState,
    startRequest,
  } = useChatState({
    initialMessages: historyMessages,
    initialSessionId: loadedSessionId || undefined,
  });

  const {
    allowedTools,
    permissionRequest,
    showPermissionRequest,
    closePermissionRequest,
    allowToolTemporary,
    allowToolPermanent,
    isPermissionMode,
    planModeRequest,
    showPlanModeRequest,
    closePlanModeRequest,
    updatePermissionMode,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  const handlePermissionError = useCallback(
    (toolName: string, patterns: string[], toolUseId: string) => {
      // Check if this is an ExitPlanMode permission error
      if (patterns.includes("ExitPlanMode")) {
        // For ExitPlanMode, show plan permission interface instead of regular permission
        showPlanModeRequest(""); // Empty plan content since it was already displayed
      } else {
        showPermissionRequest(toolName, patterns, toolUseId);
      }
    },
    [showPermissionRequest, showPlanModeRequest],
  );

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
    ) => {
      const content = messageContent || input.trim();
      if (!content || isLoading) return;

      const requestId = generateRequestId();

      // Only add user message to chat if not hidden
      if (!hideUserMessage) {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: content,
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      if (!messageContent) clearInput();
      startRequest();

      try {
        const response = await fetch(getChatUrl(), {
          method: "POST",
          headers: getAuthHeaders(token),
          body: JSON.stringify({
            message: content,
            requestId,
            ...(currentSessionId ? { sessionId: currentSessionId } : {}),
            allowedTools: tools || allowedTools,
            ...(workingDirectory ? { workingDirectory } : {}),
            permissionMode: overridePermissionMode || permissionMode,
          } as ChatRequest),
        });

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Local state for this streaming session
        let localHasReceivedInit = false;
        let shouldAbort = false;

        const streamingContext: StreamingContext = {
          currentAssistantMessage,
          setCurrentAssistantMessage,
          addMessage,
          updateLastMessage,
          onSessionId: setCurrentSessionId,
          shouldShowInitMessage: () => !hasShownInitMessage,
          onInitMessageShown: () => setHasShownInitMessage(true),
          get hasReceivedInit() {
            return localHasReceivedInit;
          },
          setHasReceivedInit: (received: boolean) => {
            localHasReceivedInit = received;
            setHasReceivedInit(received);
          },
          onPermissionError: handlePermissionError,
          onAbortRequest: async () => {
            shouldAbort = true;
            await createAbortHandler(requestId)();
          },
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done || shouldAbort) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            if (shouldAbort) break;
            processStreamLine(line, streamingContext);
          }

          if (shouldAbort) break;
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "Error: Failed to get response",
          timestamp: Date.now(),
        });
      } finally {
        resetRequestState();
      }
    },
    [
      input,
      isLoading,
      currentSessionId,
      allowedTools,
      hasShownInitMessage,
      currentAssistantMessage,
      workingDirectory,
      permissionMode,
      token,
      generateRequestId,
      clearInput,
      startRequest,
      addMessage,
      updateLastMessage,
      setCurrentSessionId,
      setHasShownInitMessage,
      setHasReceivedInit,
      setCurrentAssistantMessage,
      resetRequestState,
      processStreamLine,
      handlePermissionError,
      createAbortHandler,
    ],
  );

  const handleAbort = useCallback(() => {
    abortRequest(currentRequestId, isLoading, resetRequestState);
  }, [abortRequest, currentRequestId, isLoading, resetRequestState]);

  // Permission request handlers
  const handlePermissionAllow = useCallback(() => {
    if (!permissionRequest) return;

    // Add all patterns temporarily
    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolTemporary(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolTemporary,
    closePermissionRequest,
  ]);

  const handlePermissionAllowPermanent = useCallback(() => {
    if (!permissionRequest) return;

    // Add all patterns permanently
    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolPermanent(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolPermanent,
    closePermissionRequest,
  ]);

  const handlePermissionDeny = useCallback(() => {
    closePermissionRequest();
  }, [closePermissionRequest]);

  // Plan mode request handlers
  const handlePlanAcceptWithEdits = useCallback(() => {
    updatePermissionMode("acceptEdits");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "acceptEdits");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanAcceptDefault = useCallback(() => {
    updatePermissionMode("default");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "default");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanKeepPlanning = useCallback(() => {
    updatePermissionMode("plan");
    closePlanModeRequest();
  }, [updatePermissionMode, closePlanModeRequest]);

  // Create permission data for inline permission interface
  const permissionData = permissionRequest
    ? {
        patterns: permissionRequest.patterns,
        onAllow: handlePermissionAllow,
        onAllowPermanent: handlePermissionAllowPermanent,
        onDeny: handlePermissionDeny,
      }
    : undefined;

  // Create plan permission data for plan mode interface
  const planPermissionData = planModeRequest
    ? {
        onAcceptWithEdits: handlePlanAcceptWithEdits,
        onAcceptDefault: handlePlanAcceptDefault,
        onKeepPlanning: handlePlanKeepPlanning,
      }
    : undefined;

  const handleHistoryClick = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleSettingsClick = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleBackToChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const handleBackToHistory = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleBackToProjects = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleBackToProjectChat = useCallback(() => {
    if (workingDirectory) {
      navigate(`/projects${workingDirectory}`);
    }
  }, [navigate, workingDirectory]);

  const handleNewChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const handleRightPanelToggle = useCallback(() => {
    setIsRightPanelCollapsed((prev) => !prev);
  }, []);

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUTS.ABORT && isLoading && currentRequestId) {
        e.preventDefault();
        handleAbort();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isLoading, currentRequestId, handleAbort]);

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={handleNewChat}
        currentPathLabel={workingDirectory}
      />

      <div className="flex-1 min-w-0 p-3 sm:p-6 h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            {isHistoryView && (
              <button
                onClick={handleBackToChat}
                className="p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
                aria-label="Back to chat"
              >
                <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            )}
            {isLoadedConversation && (
              <button
                onClick={handleBackToHistory}
                className="p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
                aria-label="Back to history"
              >
                <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            )}
            <div className="min-w-0">
              <nav aria-label="Breadcrumb">
                <div className="flex items-center">
                  <button
                    onClick={handleBackToProjects}
                    className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-md px-1 -mx-1 truncate"
                    aria-label="Back to project selection"
                  >
                    Claude Code Web UI
                  </button>
                  {(isHistoryView || sessionId) && (
                    <>
                      <span
                        className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight mx-3 select-none"
                        aria-hidden="true"
                      >
                        {" "}
                        ›{" "}
                      </span>
                      <h1
                        className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight"
                        aria-current="page"
                      >
                        {isHistoryView
                          ? "Conversation History"
                          : "Conversation"}
                      </h1>
                    </>
                  )}
                </div>
              </nav>
              {workingDirectory && (
                <div className="flex items-center text-sm font-mono mt-1">
                  <button
                    onClick={handleBackToProjectChat}
                    className="text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded px-1 -mx-1 cursor-pointer"
                    aria-label={`Return to new chat in ${workingDirectory}`}
                  >
                    {workingDirectory}
                  </button>
                  {sessionId && (
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                      Session: {sessionId.substring(0, 8)}...
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isRightPanelCollapsed && (
              <button
                onClick={handleRightPanelToggle}
                className="px-3 py-2 rounded-lg panel-surface border text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                收起工具箱
              </button>
            )}
            {isRightPanelCollapsed && (
              <button
                onClick={handleRightPanelToggle}
                className="px-3 py-2 rounded-lg panel-surface border text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                打开工具箱
              </button>
            )}
            {!isHistoryView && <HistoryButton onClick={handleHistoryClick} />}
            <SettingsButton onClick={handleSettingsClick} />
          </div>
        </div>

        {/* Main Content */}
        {isHistoryView ? (
          <HistoryView onBack={handleBackToChat} />
        ) : historyLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400">
                Loading conversation history...
              </p>
            </div>
          </div>
        ) : historyError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                Error Loading Conversation
              </h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
                {historyError}
              </p>
              <button
                onClick={() => navigate({ search: "" })}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Start New Conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            <ChatMessages messages={messages} isLoading={isLoading} />
            <ChatInput
              input={input}
              isLoading={isLoading}
              currentRequestId={currentRequestId}
              onInputChange={setInput}
              onSubmit={() => sendMessage()}
              onAbort={handleAbort}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              showPermissions={isPermissionMode}
              permissionData={permissionData}
              planPermissionData={planPermissionData}
            />
          </>
        )}

        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>

      <RightPanel
        collapsed={isRightPanelCollapsed}
        onToggle={handleRightPanelToggle}
      />
    </div>
  );
}
