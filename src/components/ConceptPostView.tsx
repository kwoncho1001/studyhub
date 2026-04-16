import React, { useState, useEffect, useRef } from 'react';
import { ConceptPost, SubjectPage, getSubjectPages, getGallery, updatePost, getQnAsByPost, saveQnA, deleteQnA, PostQnA, getSubjectFiles, getSubject } from '../lib/db';
import { getPersonaPrompt } from '../lib/persona';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Loader2, Send, Trash2, Bot, User, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface ConceptPostViewProps {
  post: ConceptPost;
  subjectId: string;
  nextPost: ConceptPost | null;
  onUpdate: (post: ConceptPost) => void;
}

export function ConceptPostView({ post, subjectId, nextPost, onUpdate }: ConceptPostViewProps) {
  const [loading, setLoading] = useState(false);
  const [qnas, setQnas] = useState<PostQnA[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadQnAs();
    
    // Generate current post if needed
    if (!post.content) {
      generateContent(post, true);
    }
    
    // Immediately pre-fetch next post in parallel
    if (nextPost && !nextPost.content && !nextPost.isQuiz) {
      generateContent(nextPost, false);
    }
  }, [post.id]);

  const loadQnAs = async () => {
    const data = await getQnAsByPost(post.id);
    setQnas(data);
  };

  const generateContent = async (targetPost: ConceptPost, isCurrent: boolean) => {
    if (isCurrent) setLoading(true);
    try {
      const gallery = await getGallery(targetPost.galleryId);
      if (!gallery) return;
      
      const subject = await getSubject(subjectId);
      const personaMode = subject?.personaMode;
      const customPersona = subject?.customPersona;
      const subjectName = subject?.name || '전공';

      const allPages = await getSubjectPages(subjectId);
      let targetPages: SubjectPage[] = [];
      if (gallery.relevantUnits && gallery.relevantUnits.length > 0) {
        targetPages = allPages.filter(p => 
          gallery.relevantUnits!.some(u => u.type === 'PAGE' && u.id === `${p.fileId}:${p.pageNumber}`)
        );
      } else if (gallery.relevantPages && gallery.relevantPages.length > 0) {
        // Fallback for legacy data
        targetPages = allPages.filter(p => gallery.relevantPages!.includes(p.pageNumber));
      }

      const files = await getSubjectFiles(subjectId);
      
      // 파일 ID별 카테고리 매핑 생성
      const fileCategoryMap: Record<string, string> = {};
      for (const f of files) {
        let role = '기타 자료';
        if (f.category === 'LECTURE') role = '강의자료';
        if (f.category === 'RECORDING') role = '녹음본';
        if (f.category === 'EXAM') role = '기출문제';
        fileCategoryMap[f.id] = role;
      }

      const promptText = `
너는 '${subjectName}' 과목의 대학 시험 대비에 특화된 '퍼스널 AI 튜터'이다. 최종 목표는 사용자가 대학 시험에서 A+를 받도록 이끄는 것이다.
현재 학습 중인 과목: ${subjectName}

다음은 "${gallery.title}" 갤러리의 "${targetPost.title}" 개념글에 대한 학습 노트를 작성하는 작업이다.

[주의: 문맥 엄수]
- '${targetPost.title}'과 같은 용어가 타 분야(예: 프로그래밍, 예술 등)와 중복되더라도, 반드시 '${subjectName}' 과목의 관점에서만 설명하라.
- 절대로 프로그래밍 코드나 관련 없는 분야의 예시를 들지 마라.

${getPersonaPrompt(personaMode, customPersona)}

[대원칙: 기출 정복 중심의 학습 노트]
1. 자료 기반(Evidence-Based): 모든 설명은 제공된 핵심 참고 자료(강의자료, 녹음본, 기출문제)에 철저히 근거해야 하며, 근거 없는 외부 정보는 배제한다.
2. 시험 지향(Exam-Oriented): 학문적 탐구보다는 '시험에 나오는 것'과 '교수님의 출제 의도' 파악에 집중한다. 이 개념이 기출문제에서 어떻게 변형되어 출제되었는지 샅샅이 분석한다.
3. 깊이 있는 분석: 단순히 요약하는 것이 아니라, 원리와 인과관계를 깊이 있게 파고들어 사용자가 어떤 응용 문제도 풀 수 있게 만든다.
4. 대상 독자: 대학교 시험을 준비하는 학생. 정중하고 명확한(Mild) 톤앤매너를 유지한다.

[지식 전달 및 설명 전략]
1. 인지적 스캐폴딩: 이전 지식이 다음 지식의 발판이 되도록 단계적으로 설명한다.
2. 명확한 비유: 추상적인 개념은 구체적인 사례나 비유를 들어 설명하여 이해를 돕는다.
3. 구조적 설명: 거시적 조망(전체 맥락) 후 미시적 탐구(세부 내용)를 수행한다.
4. 시각화 (LaTeX): 수학/과학 수식은 반드시 LaTeX($...$ 및 $$...$$)를 사용하여 명확히 표기한다.
5. 실전 기출 분석: 이 개념과 관련된 기출문제가 있다면, 설명 직후 "실전 기출 분석" 섹션을 통해 문제의 핵심 논리와 풀이 전략을 분석한다.

[답변 출력 형식 (Strict Format)]
### 📍 현재 위치: [${gallery.id}-${targetPost.postId}] ${targetPost.title}

(1) 도입
- 핵심 질문을 재구성하고 흥미를 유발한다. 기출 연계 중요도를 언급한다.

(2) 본문 (개념글)
- 전문적이고 상세한 설명. 스토리텔링 기법을 적용하여 가독성을 높인다.
- 마크다운 헤딩(#, ##, ###), 굵은 글씨(**), 인용구(>) 등을 적극 활용한다.
- **[실전 기출 분석]**: (기출 관련 구간일 경우 필수로 포함) 문제의 출제 의도와 정답/오답 근거를 깊이 있게 분석한다.

(3) 시험 최적화 팁
- "이 부분은 변별력을 위해 출제될 확률이 높습니다.", "이 개념은 반드시 암기해야 합니다." 등 실전 팁을 제공한다.
`;

      const contents: any[] = [{ text: promptText }];
      
      if (targetPages.length > 0) {
        contents.push({ text: "--- 핵심 참고 자료 (PDF 페이지 텍스트) ---" });
        for (const p of targetPages) {
          const category = p.fileId ? fileCategoryMap[p.fileId] || '기타 자료' : '기타 자료';
          contents.push({ text: `[${category} - Page ${p.pageNumber} Text]:\n${p.text}` });
        }
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: contents,
      });

      if (response.text) {
        const updatedPost = { ...targetPost, content: response.text };
        await updatePost(targetPost.id, { content: response.text });
        onUpdate(updatedPost);
      }
    } catch (error) {
      console.error("Failed to generate content:", error);
    } finally {
      if (isCurrent) setLoading(false);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking) return;

    const currentQuestion = question;
    setQuestion('');
    setAsking(true);

    try {
      const subject = await getSubject(subjectId);
      const personaMode = subject?.personaMode;
      const customPersona = subject?.customPersona;

      const promptText = `
사용자가 현재 다음 학습 노트를 읽고 질문을 했습니다.
학습 노트 내용:
${post.content}

사용자 질문:
${currentQuestion}

[대원칙 및 피드백 전략]
너는 사용자가 대학 시험에서 A+를 받도록 이끄는 친절하고 전문적인 '퍼스널 AI 튜터'입니다. 모든 연령과 성별이 편안하게 느낄 수 있도록 정중하고 명확한 어투(Mild)를 사용하세요.

${getPersonaPrompt(personaMode, customPersona)}

지시사항:
1. 동적 난이도 조절: 사용자의 질문 수준을 파악해 설명의 깊이를 조절하세요.
2. 오류/오개념이 있을 경우 (3단계 학습법 적용):
   - 1단계 (핵심 재강조): 사용자가 어떤 부분에서 오해를 했는지 명확하고 부드럽게 짚어주세요.
   - 2단계 (사고 유도 힌트): 바로 정답을 떠먹여주지 말고 "이 부분을 다시 생각해 볼까요?"라며 방향을 제시하세요.
   - 3단계 (정답 해설): 그럼에도 상세한 해설을 덧붙여 완벽한 이해를 도모하세요.
3. 훌륭한 질문/이해도가 높을 경우: 따뜻하게 칭찬하며 심화 지식이나 가정을 던져 학습 의욕을 높여주세요.
4. 수식은 반드시 LaTeX($...$, $$...$$)를 사용하고, 시각 자료가 필요하면 구글 검색 키워드만 제공하세요(이미지 삽입 금지).
5. 마크다운 형식을 사용하여 가독성 있게 작성하세요.
`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: promptText,
      });

      if (response.text) {
        const newQnA: PostQnA = {
          id: crypto.randomUUID(),
          postId: post.id,
          question: currentQuestion,
          answer: response.text,
          createdAt: Date.now(),
        };
        await saveQnA(newQnA);
        setQnas(prev => [...prev, newQnA]);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    } catch (error) {
      console.error("Failed to answer question:", error);
    } finally {
      setAsking(false);
    }
  };

  const handleDeleteQnA = async (id: string) => {
    await deleteQnA(id);
    setQnas(prev => prev.filter(q => q.id !== id));
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400 space-y-4 bg-white dark:bg-neutral-900 transition-colors duration-200">
        <Loader2 className="animate-spin text-blue-600 dark:text-blue-400" size={40} />
        <p className="animate-pulse">AI가 학습 노트를 작성하고 있습니다...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-neutral-900 transition-colors duration-200">
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-2 border-b border-neutral-200 dark:border-neutral-800 pb-6 transition-colors duration-200 relative group">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">{post.title}</h1>
              <button
                onClick={() => generateContent(post, true)}
                className="flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                title="내용 다시 생성"
              >
                <RefreshCw size={14} />
                다시 쓰기
              </button>
            </div>
            <p className="text-lg text-neutral-500 dark:text-neutral-400">{post.description}</p>
          </div>
          
          <div className="prose prose-blue dark:prose-invert max-w-none prose-headings:text-blue-900 dark:prose-headings:text-blue-300 prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-neutral-700 dark:prose-p:text-neutral-300 prose-p:leading-relaxed prose-li:text-neutral-700 dark:prose-li:text-neutral-300 prose-strong:text-blue-800 dark:prose-strong:text-blue-400 prose-strong:font-bold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-blockquote:border-l-4 prose-blockquote:border-blue-500 dark:prose-blockquote:border-blue-400 prose-blockquote:bg-blue-50 dark:prose-blockquote:bg-blue-900/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:text-neutral-700 dark:prose-blockquote:text-neutral-300 rounded-2xl transition-colors duration-200">
            <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{post.content || ''}</Markdown>
          </div>

          {/* Q&A Section */}
          {qnas.length > 0 && (
            <div className="mt-12 pt-8 border-t border-neutral-200 dark:border-neutral-800 space-y-6 transition-colors duration-200">
              <h3 className="font-bold text-lg flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
                <Bot size={20} className="text-blue-600 dark:text-blue-400" />
                질문 및 답변
              </h3>
              <div className="space-y-6">
                {qnas.map(qna => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={qna.id} 
                    className="bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-5 space-y-4 relative group transition-colors duration-200"
                  >
                    <button 
                      onClick={() => handleDeleteQnA(qna.id)}
                      className="absolute top-4 right-4 text-neutral-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={16} />
                    </button>
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0 text-blue-600 dark:text-blue-400">
                        <User size={16} />
                      </div>
                      <div className="pt-1 font-medium text-neutral-900 dark:text-neutral-100">{qna.question}</div>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center flex-shrink-0 text-white">
                        <Bot size={16} />
                      </div>
                      <div className="pt-1 prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-300">
                        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{qna.answer}</Markdown>
                      </div>
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat Input */}
      <div className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 transition-colors duration-200">
        <div className="max-w-6xl mx-auto">
          <form onSubmit={handleAskQuestion} className="relative flex items-center">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="이해 안 가는 부분이 있나요? 무엇이든 물어보세요!"
              className="w-full bg-neutral-100 dark:bg-neutral-800 border-transparent focus:bg-white dark:focus:bg-neutral-900 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/50 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400 rounded-full py-3 pl-5 pr-12 text-sm transition-all outline-none"
              disabled={asking}
            />
            <button
              type="submit"
              disabled={!question.trim() || asking}
              className="absolute right-2 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {asking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
