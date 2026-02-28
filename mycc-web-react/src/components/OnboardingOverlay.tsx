import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { initializeOnboarding } from '../api/auth';

interface OnboardingOverlayProps {
  onComplete: () => Promise<void>;
  userNickname?: string;
}

interface DialogMessage {
  role: 'assistant' | 'user';
  content: string;
}

export function OnboardingOverlay({ onComplete, userNickname }: OnboardingOverlayProps) {
  const { token } = useAuth();
  const [step, setStep] = useState(0);
  const [messages, setMessages] = useState<DialogMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [assistantName, setAssistantName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultOwnerName = (userNickname || '用户').slice(0, 20);
  const defaultAssistantName = 'cc';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Typing animation for assistant messages
  const typeMessage = useCallback(async (text: string): Promise<void> => {
    setIsTyping(true);
    setShowInput(false);
    setShowButton(false);

    return new Promise((resolve) => {
      let i = 0;
      const partialMsg: DialogMessage = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, partialMsg]);

      const timer = setInterval(() => {
        i++;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: text.slice(0, i) };
          return updated;
        });
        scrollToBottom();

        if (i >= text.length) {
          clearInterval(timer);
          setIsTyping(false);
          resolve();
        }
      }, 40);
    });
  }, [scrollToBottom]);

  // Start dialog sequence
  useEffect(() => {
    const startDialog = async () => {
      await typeMessage('你好！我是你的个人 AI 助手。');
      await new Promise(r => setTimeout(r, 400));
      await typeMessage('在开始之前，给我取个名字吧？');
      setShowInput(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    };
    startDialog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStep1Submit = async () => {
    const name = input.trim() || defaultAssistantName;
    setAssistantName(name);
    setMessages(prev => [...prev, { role: 'user', content: name }]);
    setInput('');
    setShowInput(false);
    setStep(1);

    await new Promise(r => setTimeout(r, 300));
    await typeMessage(`好的，${name} 就是我了！`);
    await new Promise(r => setTimeout(r, 400));
    await typeMessage('那我该怎么称呼你呢？');
    setShowInput(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleStep2Submit = async () => {
    const name = input.trim() || defaultOwnerName;
    setOwnerName(name);
    setMessages(prev => [...prev, { role: 'user', content: name }]);
    setInput('');
    setShowInput(false);
    setStep(2);

    await new Promise(r => setTimeout(r, 300));
    await typeMessage(`${name}，很高兴认识你！`);
    await new Promise(r => setTimeout(r, 400));
    await typeMessage('简单介绍一下我能做什么：\n\n• 💬 聊天对话 — 随时找我聊，我会记住上下文\n• 🛠 技能系统 — 输入 / 触发各种技能\n• 📱 多端访问 — 手机电脑都能用');
    await new Promise(r => setTimeout(r, 400));
    await typeMessage('准备好了吗？开始吧！');
    setShowButton(true);
  };

  const handleSubmitInput = () => {
    if (isTyping || isSubmitting) return;
    if (step === 0) {
      handleStep1Submit();
    } else if (step === 1) {
      handleStep2Submit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitInput();
    }
  };

  const handleComplete = async () => {
    if (!token || isSubmitting) return;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await initializeOnboarding(token, {
        assistantName: assistantName || defaultAssistantName,
        ownerName: ownerName || defaultOwnerName,
      });
      if (res.success) {
        await onComplete();
      } else {
        setError(res.error || '初始化失败，请重试');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!token || isSubmitting) return;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await initializeOnboarding(token, {
        assistantName: defaultAssistantName,
        ownerName: defaultOwnerName,
      });
      if (res.success) {
        await onComplete();
      } else {
        setError(res.error || '初始化失败，请重试');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      {/* Decorative blurs matching LoginPage */}
      <div
        className="absolute -top-32 -left-20 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: 'var(--accent-subtle)' }}
      />
      <div
        className="absolute -bottom-24 -right-20 h-80 w-80 rounded-full opacity-35 blur-3xl"
        style={{ background: 'rgba(59,130,246,0.16)' }}
      />

      <div className="relative z-10 w-full max-w-lg mx-4">
        <div
          className="rounded-[22px] border p-5 sm:p-7"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--surface-border)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-6">
            <div
              className="h-9 w-9 rounded-[10px] text-white flex items-center justify-center text-[13px] font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
              }}
            >
              cc
            </div>
            <div>
              <div
                className="text-base font-semibold text-[var(--text-primary)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                初始化助手
              </div>
              <div className="text-xs text-[var(--text-muted)]">只需几步，定制你的专属助手</div>
            </div>
          </div>

          {/* Messages area */}
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1 mb-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'text-[var(--text-inverse)]'
                      : 'text-[var(--text-primary)] border'
                  }`}
                  style={
                    msg.role === 'user'
                      ? { background: 'var(--accent)' }
                      : { background: 'var(--bg-elevated)', borderColor: 'var(--surface-border)' }
                  }
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="text-xs text-[var(--text-muted)] px-4 py-1">输入中...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Error display */}
          {error && (
            <div className="mb-3 rounded-xl border px-3 py-2.5 text-sm text-red-500 bg-red-500/10 border-red-400/30">
              {error}
            </div>
          )}

          {/* Input area */}
          {showInput && !isTyping && (
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={step === 0 ? '比如 cc、小助手、jarvis...' : '比如 大辉哥、老板、主人...'}
                className="flex-1 rounded-xl border bg-[var(--bg-input)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all duration-200 focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--surface-border)' }}
                disabled={isSubmitting}
                maxLength={20}
              />
              <button
                onClick={handleSubmitInput}
                disabled={isSubmitting}
                className="rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text-inverse)] transition-all disabled:opacity-60"
                style={{ background: 'var(--accent)' }}
              >
                确定
              </button>
            </div>
          )}

          {/* Complete button */}
          {showButton && !isTyping && (
            <button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text-inverse)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: isSubmitting ? 'var(--accent-hover)' : 'var(--accent)' }}
            >
              {isSubmitting ? '正在初始化...' : '开始使用'}
            </button>
          )}

          {/* Skip link */}
          {!showButton && (
            <div className="mt-3 text-center">
              <button
                onClick={handleSkip}
                disabled={isSubmitting || isTyping}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
              >
                稍后设置，使用默认值
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
