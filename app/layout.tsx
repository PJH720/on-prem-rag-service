import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '넥사테크 사내 온보딩 RAG 지식 챗봇',
  description: '온프레미스 GPU 추론 기반 고신뢰도 사내 규정 및 온보딩 AI 어시스턴트 (RBAC 보안 지원)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        {children}
      </body>
    </html>
  );
}
