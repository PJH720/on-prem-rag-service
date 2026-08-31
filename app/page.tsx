'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Role } from '@/lib/types';
import {
  Shield,
  Server,
  Key,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertCircle,
  CheckCircle2,
  Lock,
  ExternalLink,
  RefreshCw,
  Trash2,
  HelpCircle,
  Building2,
  Users,
  Code,
  DollarSign,
  Search,
  Settings,
} from 'lucide-react';


interface GroundingSource {
  doc_id: string;
  doc_title: string;
  section_title: string;
  score: number;
  normalizedScore: number;
  snippet: string;
  access_role: Role;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: GroundingSource[];
  confidence?: 'high' | 'rejected';
  rejected?: boolean;
  provider?: 'on-premise' | 'byok' | 'search-only' | string;
  model?: string;
  queryRole?: Role;
}

const EXAMPLE_QUERIES = [
  {
    title: '1. 연차 발생 및 사용 규정',
    query: '연차는 입사 후 언제부터 쓸 수 있나요?',
    role: 'all' as Role,
    badge: '전사 (General)',
    desc: '기본 온보딩 질의 (1개월 개근 시 1일 발생, 반차/반반차)',
  },
  {
    title: '2. 야근 식대 및 경비 정산',
    query: '법인카드로 결제한 식대는 어떻게 정산하나요?',
    role: 'all' as Role,
    badge: '전사 (General)',
    desc: '다중 문서 검색 (야근식대 15,000원, 회식비 5만원, 25일 지급)',
  },
  {
    title: '3. 연봉 테이블 조회 (RBAC 차단)',
    query: '직급별 연봉 테이블 알려주세요',
    role: 'all' as Role,
    badge: '★ RBAC 차단 🔒',
    desc: '전사(all) 권한에서는 대외비 문서 접근 차단 (0건 유출)',
  },
  {
    title: '4. 개발 환경 로컬 스택',
    query: '로컬 개발 DB는 어떻게 구동하나요?',
    role: 'eng' as Role,
    badge: '개발팀 (Engineering)',
    desc: '개발팀 전용 문서 (Docker Compose pgvector, Redis, MinIO)',
  },
  {
    title: '5. 미등록 질문 (환각 방지)',
    query: '오늘 점심 메뉴 뭐야?',
    role: 'all' as Role,
    badge: '★ 환각 방지 거부 ⛔',
    desc: '사내 문서에 없는 내용 질의 시 100% 답변 거부',
  },
  {
    title: '6. 직급별 연봉 밴드 열람 (HR)',
    query: '인사팀 권한으로 각 직급별 연봉 밴드와 신입 초봉 기준을 알려주세요',
    role: 'hr' as Role,
    badge: '★ HR 전용 열람 🔓',
    desc: 'HR 권한으로 대외비 문서(HR-011) 정상 인용 및 상세 연봉 밴드 답변',
  },
  {
    title: '7. 사내 AI 보안 가이드라인',
    query: '사내에서 ChatGPT나 생성형 AI를 사용할 때 보안 가이드라인이 어떻게 되나요?',
    role: 'all' as Role,
    badge: '★ AI 거버넌스 🤖',
    desc: 'Tier 1~3 도구 등급 및 Class 1~4 데이터 기밀 입력 제한 규정',
  },
  {
    title: '8. 인프라 DevOps실 R&R 및 리더',
    query: '인프라 DevOps실 담당 부서장과 주요 업무가 무엇인가요?',
    role: 'all' as Role,
    badge: '전사 조직도 👥',
    desc: '120명 조직 체계 및 인프라 DevOps실 리더/담당 업무 검색',
  },
  {
    title: '9. 인사평가 등급 및 기록 (HR)',
    query: '인사팀 권한으로 임직원 인사평가 등급 배분 비율과 인사기록 샘플을 보여주세요',
    role: 'hr' as Role,
    badge: '★ HR 평가기록 🔓',
    desc: 'HR 권한(HR-012) 전용 S/A/B/C 정규분포 및 인사기록 카드 열람',
  },
];


const ROLES: { id: Role; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: 'all',
    label: '전사 (General)',
    icon: <Users className="w-4 h-4" />,
    desc: '취업규칙, 연차, 재택, 경비/법카, 복리후생, 보안',
  },
  {
    id: 'hr',
    label: '인사팀 (HR)',
    icon: <Building2 className="w-4 h-4" />,
    desc: '★ 연봉 테이블(HR-011), 직급별 기본급 밴드 열람 가능',
  },
  {
    id: 'eng',
    label: '개발팀 (Engineering)',
    icon: <Code className="w-4 h-4" />,
    desc: '개발 환경 셋업(ENG-001), Docker 스택, 배포 동결',
  },
  {
    id: 'finance',
    label: '재무팀 (Finance)',
    icon: <DollarSign className="w-4 h-4" />,
    desc: '경비 정산 규정, 예산 승인 한도',
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentRole, setCurrentRole] = useState<Role>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [byokKey, setByokKey] = useState('');
  const [isByokModalOpen, setIsByokModalOpen] = useState(false);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load BYOK key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('nexatech_byok_key');
    if (saved) setByokKey(saved);
  }, []);

  const handleSaveByok = (key: string) => {
    setByokKey(key);
    if (key.trim()) {
      localStorage.setItem('nexatech_byok_key', key.trim());
    } else {
      localStorage.removeItem('nexatech_byok_key');
    }
    setIsByokModalOpen(false);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleSources = (msgId: string) => {
    setOpenSources(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleSend = async (queryText?: string, overrideRole?: Role) => {
    const textToSend = queryText || input;
    const roleToSend = overrideRole || currentRole;

    if (!textToSend.trim() || isLoading) return;

    const userMessageId = `user_${Date.now()}`;
    const assistantMessageId = `asst_${Date.now()}`;

    const userMsg: Message = {
      id: userMessageId,
      role: 'user',
      content: textToSend.trim(),
      queryRole: roleToSend,
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(byokKey ? { 'x-byok-key': byokKey } : {}),
        },
        body: JSON.stringify({
          message: textToSend.trim(),
          role: roleToSend,
          history: messages.slice(-4).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        throw new Error(`서버 오류 발생 (${response.status})`);
      }

      if (!response.body) {
        throw new Error('응답 스트림이 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let assistantContent = '';
      let metadataParsed = false;
      let metaObj: {
        confidence?: 'high' | 'rejected';
        provider?: string;
        model?: string;
        sources?: GroundingSource[];
        rejected?: boolean;
      } = {};

      let buffer = '';

      // Initialize assistant placeholder
      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          queryRole: roleToSend,
        },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (!metadataParsed) {
          const metaIndex = buffer.indexOf('__METADATA__:');
          const endMetaIndex = buffer.indexOf('\n\n');

          if (metaIndex !== -1 && endMetaIndex !== -1) {
            const metaJson = buffer.slice(metaIndex + '__METADATA__:'.length, endMetaIndex);
            try {
              metaObj = JSON.parse(metaJson);
              metadataParsed = true;
              buffer = buffer.slice(endMetaIndex + 2);

              setOpenSources(prev => ({
                ...prev,
                [assistantMessageId]: metaObj.confidence === 'high',
              }));
            } catch (e) {
              console.error('Failed to parse metadata:', e);
            }
          }
        }

        if (metadataParsed) {
          assistantContent += buffer;
          buffer = '';

          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    content: assistantContent,
                    sources: metaObj.sources,
                    confidence: metaObj.confidence,
                    rejected: metaObj.rejected,
                    provider: metaObj.provider,
                    model: metaObj.model,
                  }
                : m
            )
          );
        }
      }
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : '답변 생성 중 오류가 발생했습니다.';
      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: `⚠️ 오류: ${errMsg}`,
          confidence: 'rejected',
          rejected: true,
          queryRole: roleToSend,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Highlight citation tags like [출처: 문서명 §섹션]
  const renderFormattedContent = (content: string) => {
    const parts = content.split(/(\[출처:\s*[^\]]+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[출처:') && part.endsWith(']')) {
        return (
          <span
            key={i}
            className="inline-flex items-center px-2 py-0.5 my-0.5 mx-1 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs"
          >
            🔖 {part.slice(1, -1)}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 min-h-screen">
      {/* 1. Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                NexaTech 사내 온보딩 지식 챗봇
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  RAG v1.0
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                온프레미스 GPU 추론 기반 고신뢰도 사내 지식 검색 시스템 (BM25 + RBAC 보안 필터)
              </p>
            </div>
          </div>
        </div>

        {/* Status Badges & Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Engine Status Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border shadow-xs bg-emerald-50 text-emerald-800 border-emerald-200">
            <Server className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              {byokKey
                ? '하이브리드 모드 (API 키 연동)'
                : '온프레미스 sLLM (Qwen3.8)'}
            </span>
          </div>

          {/* Settings Modal Trigger */}
          <button
            onClick={() => setIsByokModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-md transition shadow-xs"
            title="엔드포인트 설정"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500" />
            <span>{byokKey ? '연동 설정 관리' : '연동 설정'}</span>
          </button>

          {/* Reset Chat */}
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              title="대화 초기화"
              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md border border-slate-200 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>


      {/* 2. Role Selector (RBAC Control) */}
      <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>질문자 접근 권한 (RBAC Role 선택)</span>
          </div>
          <span className="text-xs text-slate-500">
            권한에 따라 검색 대상 문서가 사전 필터링(Pre-filter)됩니다.
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ROLES.map(r => {
            const isSelected = currentRole === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setCurrentRole(r.id)}
                className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/10'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
                  {r.icon}
                  <span>{r.label}</span>
                </div>
                <span
                  className={`text-[11px] leading-tight line-clamp-1 ${
                    isSelected ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {r.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Chat Messages Feed */}
      <div className="flex-1 overflow-y-auto my-4 space-y-4 pr-1">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-3xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4 shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-1">
              넥사테크 온보딩 지식 챗봇에 오신 것을 환영합니다!
            </h2>
            <p className="text-xs text-slate-600 mb-6 leading-relaxed">
              사내 규정(연차, 경비, 복리후생, 개발 환경, 비밀유지, 연봉/평가 등)을 바탕으로
              정확한 출처 인용과 함께 답변합니다.
            </p>

            {/* Example Queries */}
            <div className="w-full space-y-2 text-left">
              <div className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>1-Click 핵심 검증 시나리오 (클릭 시 자동 실행):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EXAMPLE_QUERIES.map((eq, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentRole(eq.role);
                      handleSend(eq.query, eq.role);
                    }}
                    className="p-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded-lg shadow-xs transition group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-slate-800 group-hover:text-emerald-700">
                        {eq.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                        {eq.badge}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mb-1">{eq.query}</div>
                    <div className="text-[10px] text-slate-400">{eq.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map(m => {
            const isUser = m.role === 'user';
            const isRejected = m.rejected;
            const isSourcesOpen = openSources[m.id] ?? false;

            return (
              <div
                key={m.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
              >
                {/* Role badge for query context */}
                {isUser && m.queryRole && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-medium">
                    권한: {m.queryRole.toUpperCase()}
                  </span>
                )}

                {/* Message Bubble */}
                <div
                  className={`max-w-3xl rounded-2xl p-4 shadow-xs text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-slate-900 text-white rounded-br-none'
                      : isRejected
                      ? 'bg-amber-50 text-slate-800 border border-amber-200 rounded-bl-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
                  }`}
                >
                  {isUser ? m.content : renderFormattedContent(m.content)}
                </div>

                {/* Grounding & Confidence Panel (Assistant only) */}
                {!isUser && (
                  <div className="w-full max-w-3xl space-y-2">
                    {/* Status Bar */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      {/* Confidence Tag */}
                      <div className="flex items-center gap-1.5">
                        {isRejected ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium border border-amber-300">
                            <AlertCircle className="w-3.5 h-3.5" />
                            근거 부족 (환각 방지 답변 거부)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium border border-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            사내 문서 근거 100% 매칭
                          </span>
                        )}

                        {m.model && (
                          <span className="text-[11px] text-slate-400">
                            {m.model}
                          </span>
                        )}
                      </div>

                      {/* Source Toggle Button */}
                      {m.sources && m.sources.length > 0 && (
                        <button
                          onClick={() => toggleSources(m.id)}
                          className="flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md transition"
                        >
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          <span>참조 문서 근거 ({m.sources.length}건)</span>
                          {isSourcesOpen ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Sources Cards View */}
                    {isSourcesOpen && m.sources && m.sources.length > 0 && (
                      <div className="grid grid-cols-1 gap-2 pt-1">
                        {m.sources.map((src, sIdx) => (
                          <div
                            key={sIdx}
                            className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                <span className="px-1.5 py-0.5 bg-slate-200 rounded text-[10px] font-mono">
                                  {src.doc_id}
                                </span>
                                <span>{src.doc_title}</span>
                                <span className="text-slate-500 font-normal">
                                  § {src.section_title}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700">
                                  권한: {src.access_role}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                                  BM25: {src.score.toFixed(1)} (
                                  {Math.round(src.normalizedScore * 100)}%)
                                </span>
                              </div>
                            </div>
                            <p className="text-slate-600 leading-relaxed bg-white p-2 rounded border border-slate-100">
                              {src.snippet}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 4. Input Area */}
      <div className="pt-2">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSend();
          }}
          className="relative bg-white rounded-xl border border-slate-300 shadow-sm focus-within:ring-2 focus-within:ring-emerald-600 focus-within:border-emerald-600 transition"
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`[${currentRole.toUpperCase()} 권한] 사내 규정이나 온보딩 관련 질문을 입력하세요... (Enter로 전송, Shift+Enter로 줄바꿈)`}
            className="w-full p-3 pr-24 bg-transparent border-0 resize-none focus:outline-none text-sm text-slate-800 placeholder-slate-400"
          />

          <div className="absolute right-2 bottom-2.5 flex items-center gap-1">
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>생성 중</span>
                </>
              ) : (
                <>
                  <span>전송</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>

        <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400 px-1">
          <span>
            💡 검색된 사내 문서 청크에 100% 근거하여 인용이 생성되며, 근거 부족 시 환각을 차단합니다.
          </span>
          <span className="font-mono">Next.js 15 + BM25 RBAC</span>
        </div>
      </div>

      {/* 5. Endpoint Settings Modal */}
      {isByokModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Settings className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                추론 엔진 연동 설정 (선택 사항)
              </h3>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              본 시스템은 <strong>사내 온프레미스 sLLM 추론 엔진(Qwen3.8-Flash)</strong>을 기본으로 사용합니다.
              폐쇄망 외부 환경 테스트나 하이브리드 연동이 필요한 경우에만 대체 API 키를 등록하세요.
            </p>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 mb-4 flex items-start gap-2">
              <Shield className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>보안 원칙:</strong> 입력된 키는 브라우저의 <code>localStorage</code>에만 보관되며,
                서버에 절대 영구 저장되지 않고 단발성 요청 헤더로만 전달됩니다.
              </span>
            </div>

            <div className="space-y-2 mb-6">
              <label className="text-xs font-semibold text-slate-700">
                대체 API Key (선택 사항)
              </label>
              <input
                type="password"
                value={byokKey}
                onChange={e => setByokKey(e.target.value)}
                placeholder="sk-..."
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
              />
            </div>


            <div className="flex items-center justify-end gap-2">
              {byokKey && (
                <button
                  type="button"
                  onClick={() => handleSaveByok('')}
                  className="px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition"
                >
                  키 삭제 (기본 모드로 복귀)
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsByokModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => handleSaveByok(byokKey)}
                className="px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition shadow"
              >
                저장 및 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
