import React, { useState } from 'react';
import { ExamSession, updateExamSession, QuizItem } from '../lib/db';
import { Loader2, Send, CheckCircle2, XCircle, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface ExamViewProps {
  session: ExamSession;
  onUpdate: (session: ExamSession) => void;
}

export function ExamView({ session, onUpdate }: ExamViewProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);

  const handleAnswerChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async () => {
    setGrading(true);
    
    // AI 채점 프롬프트
    const promptText = `
다음은 기출문제와 사용자의 답안입니다. 각 문제에 대해 채점하고 피드백을 제공해주세요.
퀴즈 데이터:
${JSON.stringify(session.questions.map(q => ({
  id: q.id,
  question: q.question,
  userAnswer: answers[q.id] || '(미입력)'
})), null, 2)}

지시사항:
1. 각 문제별로 정답 여부(isCorrect)와 상세 해설(feedback)을 제공하세요.
2. JSON 배열 형식으로 응답하세요.
`;

    try {
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
                id: { type: Type.STRING },
                isCorrect: { type: Type.BOOLEAN },
                feedback: { type: Type.STRING },
              },
              required: ['id', 'isCorrect', 'feedback'],
            },
          },
        },
      });

      if (response.text) {
        const results = JSON.parse(response.text) as any[];
        const updatedQuestions = session.questions.map(q => {
          const res = results.find(r => r.id === q.id);
          return { ...q, userAnswer: answers[q.id], isCorrect: res?.isCorrect, feedback: res?.feedback };
        });
        
        const score = updatedQuestions.filter(q => q.isCorrect).length;
        const updatedSession = { ...session, questions: updatedQuestions, score, completed: true };
        await updateExamSession(session.id, updatedSession);
        onUpdate(updatedSession);
      }
    } catch (e) {
      console.error("채점 실패", e);
    } finally {
      setGrading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <h2 className="text-2xl font-bold">{session.title}</h2>
      
      {session.questions.map((q, index) => (
        <div key={q.id} className="bg-white dark:bg-neutral-800 p-6 rounded-xl border">
          <p className="font-medium mb-4">{index + 1}. {q.question}</p>
          <textarea
            className="w-full p-3 border rounded-lg"
            value={answers[q.id] || ''}
            onChange={(e) => handleAnswerChange(q.id, e.target.value)}
            disabled={session.completed}
          />
          {session.completed && q.feedback && (
            <div className={`mt-4 p-4 rounded-lg ${q.isCorrect ? 'bg-green-100' : 'bg-red-100'}`}>
              <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{q.feedback}</Markdown>
            </div>
          )}
        </div>
      ))}

      {!session.completed && (
        <button
          onClick={handleSubmit}
          disabled={grading}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold"
        >
          {grading ? <Loader2 className="animate-spin mx-auto" /> : '채점하기'}
        </button>
      )}
    </div>
  );
}
