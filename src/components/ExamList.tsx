import React, { useState, useEffect } from 'react';
import { SubjectFile, ExamSession, saveExamSession, getSubjectFiles, getGalleriesBySubject } from '../lib/db';
import { Loader2, FileText, PlayCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface ExamListProps {
  subjectId: string;
  onSelectSession: (session: ExamSession) => void;
}

export function ExamList({ subjectId, onSelectSession }: ExamListProps) {
  const [files, setFiles] = useState<SubjectFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFiles();
  }, [subjectId]);

  const loadFiles = async () => {
    const allFiles = await getSubjectFiles(subjectId);
    setFiles(allFiles.filter(f => f.category === 'EXAM'));
    setLoading(false);
  };

  const startExam = async (file: SubjectFile) => {
    const galleries = await getGalleriesBySubject(subjectId);
    const allowedQuestionIds = new Set<string>();
    galleries.forEach(g => {
      g.mappedExamIds?.forEach(id => allowedQuestionIds.add(id));
    });

    // 선별 모드 적용: 매핑된 문제가 하나라도 있으면 필터링, 없으면 전체 문제
    const isSelectionMode = allowedQuestionIds.size > 0;
    const filteredQuestions = isSelectionMode 
      ? (file.parsedQuestions || []).filter(q => allowedQuestionIds.has(q.id))
      : (file.parsedQuestions || []);

    const session: ExamSession = {
      id: crypto.randomUUID(),
      subjectId,
      fileId: file.id,
      title: `${file.name} - ${new Date().toLocaleDateString()}`,
      questions: filteredQuestions.map(q => ({
        id: q.id,
        question: q.questionText,
      })),
      completed: false,
      createdAt: Date.now(),
    };
    await saveExamSession(session);
    onSelectSession(session);
  };

  if (loading) return <div className="p-8 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">기출문제 세트</h3>
      {files.length === 0 ? (
        <p className="text-neutral-500 text-sm">등록된 기출문제 파일이 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {files.map(file => (
            <motion.button
              key={file.id}
              whileHover={{ scale: 1.01 }}
              onClick={() => startExam(file)}
              className="flex items-center justify-between p-4 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-blue-500 transition-all"
            >
              <div className="flex items-center gap-3">
                <FileText className="text-blue-500" />
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{file.name}</span>
              </div>
              <PlayCircle className="text-neutral-400" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
