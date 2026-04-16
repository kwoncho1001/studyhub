import React, { useState, useEffect } from 'react';
import { ConceptPost, SubjectPage, getSubjectPages, getGallery, updatePost, QuizItem, getPostsByGallery, getSubjectFiles, getSubject } from '../lib/db';
import { getPersonaPrompt } from '../lib/persona';
import { GoogleGenAI, Type } from '@google/genai';
import { Loader2, CheckCircle2, XCircle, Send, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface QuizViewProps {
  post: ConceptPost;
  subjectId: string;
  onUpdate: (post: ConceptPost) => void;
}

export function QuizView({ post, subjectId, onUpdate }: QuizViewProps) {
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!post.quizData || post.quizData.length === 0) {
      generateQuiz();
    } else {
      // Initialize answers from existing data
      const initialAnswers: Record<string, string> = {};
      post.quizData.forEach(q => {
        if (q.userAnswer) initialAnswers[q.id] = q.userAnswer;
      });
      setAnswers(initialAnswers);
    }
  }, [post.id]);

  const generateQuiz = async () => {
    setLoading(true);
    try {
      const gallery = await getGallery(post.galleryId);
      if (!gallery) return;

      const subject = await getSubject(subjectId);
      const personaMode = subject?.personaMode;
      const customPersona = subject?.customPersona;

      const allPages = await getSubjectPages(subjectId);
      let targetPages: SubjectPage[] = [];
      if (gallery.relevantUnits && gallery.relevantUnits.length > 0) {
        targetPages = allPages.filter(p => 
          gallery.relevantUnits!.some(u => u.type === 'PAGE' && u.id === `${p.fileId}:${p.pageNumber}`)
        );
      } else if (gallery.relevantPages && gallery.relevantPages.length > 0) {
        targetPages = allPages.filter(p => gallery.relevantPages!.includes(p.pageNumber));
      }

      const files = await getSubjectFiles(subjectId);
      const filesContext = files.map(f => {
        let role = '';
        if (f.category === 'LECTURE') role = '강의자료 (전반적인 개념과 뼈대)';
        if (f.category === 'RECORDING') role = '녹음본 (실제 진도 범위 및 핵심 강조 포인트)';
        if (f.category === 'EXAM') role = '기출문제 (실전 감각 및 출제 포인트)';
        return `[${role}] 파일명: ${f.name}\n${f.content}`;
      }).join('\n\n====================\n\n');

      const galleryPosts = await getPostsByGallery(post.galleryId);
      const conceptContents = galleryPosts
        .filter(p => !p.isQuiz && p.content)
        .map(p => `[${p.title}]\n${p.content}`)
        .join('\n\n');

      const promptText = `
다음은 "${gallery.title}" 갤러리에 대한 최종 마무리 퀴즈를 생성하는 작업입니다.

${getPersonaPrompt(personaMode, customPersona)}

지시사항:
1. 제공된 핵심 참고 자료와 갤러리의 개념글 내용을 바탕으로, 해당 갤러리의 전체 범위를 아우르는 주관식 문제 20개를 출제하세요.
2. 문제는 단답형이나 간단한 서술형으로 답변할 수 있는 수준으로 출제하세요.
3. JSON 배열 형식으로 응답해주세요.
`;

      const contents: any[] = [{ text: promptText }];
      
      if (targetPages.length > 0) {
        contents.push({ text: "--- 핵심 참고 자료 (PDF 페이지) ---" });
        for (const p of targetPages) {
          contents.push({ text: `[Page ${p.pageNumber} Text]:\n${p.text}` });
        }
      } else if (files.length > 0) {
        contents.push({ text: `--- 핵심 참고 자료 (전체 파일) ---\n${filesContext}` });
      }

      if (conceptContents) {
        contents.push({ text: `--- 갤러리 개념글 내용 ---\n${conceptContents}` });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: '문제 고유 ID (예: Q1)' },
                question: { type: Type.STRING, description: '주관식 문제 내용' },
              },
              required: ['id', 'question'],
            },
          },
        },
      });

      if (response.text) {
        const parsedQuestions = JSON.parse(response.text) as any[];
        const quizData: QuizItem[] = parsedQuestions.map(q => ({
          id: crypto.randomUUID(),
          question: q.question,
        }));
        
        const updatedPost = { ...post, quizData };
        await updatePost(post.id, { quizData });
        onUpdate(updatedPost);
      }
    } catch (error) {
      console.error("Failed to generate quiz:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const handleAnswerBlur = async (id: string, value: string) => {
    if (!post.quizData) return;
    const updatedQuizData = post.quizData.map(q => 
      q.id === id ? { ...q, userAnswer: value } : q
    );
    const updatedPost = { ...post, quizData: updatedQuizData };
    await updatePost(post.id, { quizData: updatedQuizData });
    // We update the parent state so it persists if we navigate away and back
    onUpdate(updatedPost);
  };

  const handleSubmit = async () => {
    if (!post.quizData) return;
    setGrading(true);

    try {
      const gallery = await getGallery(post.galleryId);
      const subject = await getSubject(subjectId);
      const personaMode = subject?.personaMode;
      const customPersona = subject?.customPersona;
      
      const promptText = `
다음은 "${gallery?.title || '갤러리'}"에 대한 주관식 퀴즈와 사용자의 답안입니다.
각 문제에 대해 사용자의 답안이 맞는지 틀린지 채점하고, 피드백을 제공해주세요.

퀴즈 데이터:
${JSON.stringify(post.quizData.map(q => ({
  id: q.id,
  question: q.question,
  userAnswer: answers[q.id] || '(미입력)'
})), null, 2)}

[피드백 전략 및 어투]
너는 사용자가 대학 시험에서 A+를 받도록 이끄는 친절하고 전문적인 '퍼스널 AI 튜터'입니다. 모든 연령과 성별이 편안하게 느낄 수 있도록 정중하고 명확한 어투(Mild)를 사용하세요.

${getPersonaPrompt(personaMode, customPersona)}

지시사항:
1. 정답인 경우: 따뜻하게 칭찬하며, 해당 지식이 어떻게 더 깊게 응용될 수 있는지(심화 지식/가정) 짧게 덧붙여 학습 의욕을 높여주세요.
2. 오답인 경우 (3단계 학습법 적용):
   - 1단계: 사용자가 어떤 부분에서 오해를 했는지 명확하고 부드럽게 짚어주세요.
   - 2단계: "이 부분을 다시 생각해 볼까요?"라며 스스로 사고를 유도하는 힌트를 제공하세요.
   - 3단계: 마지막에 정확한 정답과 상세한 해설을 제공하여 완벽히 이해시키세요.
3. 수식은 반드시 LaTeX($...$, $$...$$)를 사용하세요.
4. 각 문제별로 isCorrect (boolean)와 feedback (string)을 평가하여 JSON 배열 형식으로 응답해주세요.
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: '문제 고유 ID' },
                isCorrect: { type: Type.BOOLEAN, description: '정답 여부' },
                feedback: { type: Type.STRING, description: '해설 및 피드백 (정답인 경우 칭찬, 오답인 경우 올바른 설명)' },
              },
              required: ['id', 'isCorrect', 'feedback'],
            },
          },
        },
      });

      if (response.text) {
        const gradingResults = JSON.parse(response.text) as any[];
        
        const updatedQuizData = post.quizData.map(q => {
          const result = gradingResults.find(r => r.id === q.id);
          return {
            ...q,
            userAnswer: answers[q.id],
            isCorrect: result?.isCorrect,
            feedback: result?.feedback
          };
        });

        const updatedPost = { ...post, quizData: updatedQuizData };
        await updatePost(post.id, { quizData: updatedQuizData });
        onUpdate(updatedPost);
      }
    } catch (error) {
      console.error("Failed to grade quiz:", error);
    } finally {
      setGrading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400 space-y-4 bg-neutral-50 dark:bg-neutral-900 transition-colors duration-200">
        <Loader2 className="animate-spin text-blue-600 dark:text-blue-400" size={40} />
        <p className="animate-pulse">AI가 갤러리 전체 범위를 아우르는 퀴즈를 출제하고 있습니다...</p>
      </div>
    );
  }

  const isGraded = post.quizData?.some(q => q.isCorrect !== undefined);
  const correctCount = post.quizData?.filter(q => q.isCorrect).length || 0;
  const totalCount = post.quizData?.length || 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-50 dark:bg-neutral-900 transition-colors duration-200">
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="space-y-4 text-center pb-6 border-b border-neutral-200 dark:border-neutral-800 transition-colors duration-200">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 mb-2">
              <Trophy size={32} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">최종 마무리 퀴즈</h1>
            <p className="text-lg text-neutral-500 dark:text-neutral-400">지금까지 학습한 내용을 20개의 주관식 문제로 점검해보세요.</p>
            
            {isGraded && (
              <div className="inline-flex items-center gap-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-4 py-2 rounded-full font-bold text-lg shadow-sm mt-4 text-neutral-900 dark:text-neutral-100 transition-colors duration-200">
                점수: <span className={correctCount > totalCount * 0.7 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{correctCount} / {totalCount}</span>
              </div>
            )}
          </div>

          <div className="space-y-8">
            {post.quizData?.map((q, index) => (
              <motion.div 
                key={`${q.id}-${index}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`bg-white dark:bg-neutral-800 rounded-xl border p-6 shadow-sm transition-colors duration-200 ${
                  q.isCorrect === true ? 'border-green-200 dark:border-green-900/50 bg-green-50/30 dark:bg-green-900/10' : 
                  q.isCorrect === false ? 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-900/10' : 'border-neutral-200 dark:border-neutral-700'
                }`}
              >
                <div className="flex gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {q.isCorrect === true ? (
                      <CheckCircle2 className="text-green-500 dark:text-green-400" size={24} />
                    ) : q.isCorrect === false ? (
                      <XCircle className="text-red-500 dark:text-red-400" size={24} />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                        {index + 1}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-4">
                    <h3 className="font-medium text-lg text-neutral-900 dark:text-neutral-100">{q.question}</h3>
                    
                    <textarea
                      value={answers[q.id] || ''}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      onBlur={(e) => handleAnswerBlur(q.id, e.target.value)}
                      disabled={isGraded || grading}
                      placeholder="답안을 입력하세요..."
                      className="w-full p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 focus:bg-white dark:focus:bg-neutral-800 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/50 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all resize-none disabled:opacity-70 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400"
                      rows={2}
                    />

                    {q.feedback && (
                      <div className={`p-4 rounded-lg text-sm transition-colors duration-200 ${q.isCorrect ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'}`}>
                        <div className="font-bold mb-1 flex items-center gap-1">
                          {q.isCorrect ? '정답입니다!' : '오답입니다.'}
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{q.feedback}</Markdown>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {!isGraded && post.quizData && post.quizData.length > 0 && (
            <div className="flex justify-center pt-8 pb-12">
              <button
                onClick={handleSubmit}
                disabled={grading}
                className="flex items-center gap-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all shadow-md hover:shadow-lg disabled:opacity-50"
              >
                {grading ? (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    AI 채점 중...
                  </>
                ) : (
                  <>
                    <Send size={24} />
                    답안 제출 및 채점하기
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
