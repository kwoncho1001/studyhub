import React, { createContext, useContext, useState, useCallback } from 'react';
import { processPDFPages } from '../lib/pdfParser';
import { processTXTFile } from '../lib/txtParser';
import { saveSubjectFile, saveSubjectPages, saveSubjectSegments, FileCategory, SubjectPage, SubjectSegment } from '../lib/db';
import { clusterFileLocally } from '../lib/clustering';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export type UploadTask = {
  id: string;
  subjectId: string;
  fileName: string;
  progress: string;
  status: 'uploading' | 'analyzing' | 'done' | 'error';
  error?: string;
};

interface UploadContextType {
  tasks: UploadTask[];
  uploadFiles: (subjectId: string, files: FileList | File[], category: FileCategory) => void;
  removeTask: (taskId: string) => void;
  lastCompletedAt: number;
}

const UploadContext = createContext<UploadContextType | null>(null);

export const useUpload = () => {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [lastCompletedAt, setLastCompletedAt] = useState<number>(0);

  const updateTask = useCallback((id: string, updates: Partial<UploadTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const uploadFiles = async (subjectId: string, files: FileList | File[], category: FileCategory) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const taskId = crypto.randomUUID();
      
      setTasks(prev => [...prev, {
        id: taskId,
        subjectId,
        fileName: file.name,
        progress: '준비 중...',
        status: 'uploading'
      }]);

      try {
        let fullText = "";
        const fileId = crypto.randomUUID();
        const subjectPages: SubjectPage[] = [];
        let segments: SubjectSegment[] = [];
        const pageAnalysisResults: any[] = [];

        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          updateTask(taskId, { progress: `${file.name} 페이지 렌더링 중...` });
          const pages = await processPDFPages(file, (curr, total) => {
            updateTask(taskId, { progress: `${file.name} 렌더링 중... (${curr}/${total})` });
          });

          const CHUNK_SIZE = 5;
          let processedCount = 0;

          for (let j = 0; j < pages.length; j += CHUNK_SIZE) {
            const chunk = pages.slice(j, j + CHUNK_SIZE);

            const chunkResults = await Promise.all(
              chunk.map(async (p) => {
                let pageText = p.text.trim();
                let pageQuestions: any[] = [];
                let pageMetadata: any = null;

                if (category === "EXAM" && p.imageBase64) {
                  try {
                    const base64Data = p.imageBase64.split(",")[1];
                    const promptText = `이 기출문제 이미지에서 텍스트를 추출하고, 동시에 개별 문항들을 추출하여 JSON으로 반환해.
만약 이 페이지에 시험 정보(연도, 학기, 시험종류, 학년)가 있다면 함께 추출해줘.

지시사항:
1. text: 이미지에서 추출된 전체 텍스트 (수식, 도표 설명 포함)
2. metadata: { year, term, type, grade } - 이 페이지에서 명시적으로 확인되는 경우만 채우고, 없으면 빈 문자열("")로 둬.
3. questions: [ { questionText } ] - 이 페이지에 있는 개별 문항 리스트. (ID는 나중에 부여할테니 내용만 정확히 뽑아줘)`;

                    const ocrRes = await ai.models.generateContent({
                      model: "gemini-2.5-flash-lite",
                      contents: [
                        { text: promptText },
                        {
                          inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Data,
                          },
                        },
                      ],
                      config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                          type: Type.OBJECT,
                          properties: {
                            text: { type: Type.STRING },
                            metadata: {
                              type: Type.OBJECT,
                              properties: {
                                year: { type: Type.STRING },
                                term: { type: Type.STRING },
                                type: { type: Type.STRING },
                                grade: { type: Type.STRING },
                              },
                              required: ["year", "term", "type", "grade"]
                            },
                            questions: {
                              type: Type.ARRAY,
                              items: {
                                type: Type.OBJECT,
                                properties: {
                                  questionText: { type: Type.STRING }
                                },
                                required: ["questionText"]
                              }
                            }
                          },
                          required: ["text", "metadata", "questions"]
                        }
                      }
                    });
                    if (ocrRes.text) {
                      const parsed = JSON.parse(ocrRes.text);
                      pageText = parsed.text || pageText;
                      pageQuestions = parsed.questions || [];
                      pageMetadata = parsed.metadata;
                    }
                  } catch (e) {
                    console.error("EXAM Page Analysis failed", p.pageNumber, e);
                  }
                } else if ((category === "EXAM" || pageText.length <= 100) && p.imageBase64) {
                  try {
                    const base64Data = p.imageBase64.split(",")[1];
                    const promptText =
                      category === "EXAM"
                        ? "이 기출문제 이미지에 있는 모든 텍스트, 수식, 그래프, 도표를 완벽하게 추출하고 의미를 설명해줘. 기존에 추출된 텍스트가 있다면 참고해서 더 정확하게 만들어줘.\n기존 텍스트:\n" +
                          pageText
                        : "이 이미지에 있는 모든 텍스트를 추출해줘. 만약 화학 구조식, 반응 메커니즘 도표, 그래프 등이 있다면 그 의미와 내용을 텍스트로 상세히 설명해줘.";

                    const ocrRes = await ai.models.generateContent({
                      model: "gemini-2.0-flash-lite",
                      contents: [
                        { text: promptText },
                        {
                          inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Data,
                          },
                        },
                      ],
                    });
                    if (ocrRes.text) {
                      pageText = ocrRes.text;
                    }
                  } catch (e) {
                    console.error("OCR/Image Analysis failed for page", p.pageNumber, e);
                  }
                }

                const embedText = pageText || `Page ${p.pageNumber} (Image only)`;
                let embedding: number[] = [];
                try {
                  const embedRes = await ai.models.embedContent({
                    model: "gemini-embedding-2-preview",
                    contents: embedText,
                  });
                  embedding = (embedRes.embeddings?.[0]?.values || []).map(
                    (v) => Number(v.toFixed(4)),
                  );
                } catch (e) {
                  console.error("Embedding failed for page", p.pageNumber, e);
                }

                processedCount++;
                updateTask(taskId, { progress: `${file.name} AI 분석 중... (${processedCount}/${pages.length})` });

                return {
                  pageNumber: p.pageNumber,
                  text: pageText,
                  embedding,
                  questions: pageQuestions,
                  metadata: pageMetadata
                };
              }),
            );

            for (const res of chunkResults) {
              subjectPages.push({
                id: crypto.randomUUID(),
                subjectId,
                fileId,
                pageNumber: res.pageNumber,
                text: res.text,
                embedding: res.embedding,
              });
              pageAnalysisResults.push({
                pageNumber: res.pageNumber,
                questions: res.questions,
                metadata: res.metadata
              });
              fullText += `\n\n--- Page ${res.pageNumber} ---\n${res.text}`;
            }
          }
        } else if (file.type === "text/plain" || file.name.endsWith(".txt")) {
          updateTask(taskId, { progress: `${file.name} AI 후처리 중...` });
          segments = await processTXTFile(file, subjectId, fileId, (progress) => {
            updateTask(taskId, { progress: `${file.name} ${progress}` });
          });
          await saveSubjectSegments(segments);
          fullText = segments.map(s => s.text).join('\n\n');
        } else {
          throw new Error(`지원하지 않는 파일 형식입니다: ${file.name}`);
        }

        let parsedQuestions: any[] | undefined = undefined;
        let examYear = "";
        let examTerm = "";
        let examType = "";
        let examGrade = "";

        if (category === "EXAM") {
          updateTask(taskId, { progress: `${file.name} 기출문제 최종 정리 중...` });
          
          const allQuestions: any[] = [];
          let currentMetadata = { year: "", term: "", type: "", grade: "" };
          
          // 페이지 번호 순으로 정렬하여 메타데이터 계승 처리
          pageAnalysisResults.sort((a, b) => a.pageNumber - b.pageNumber);
          
          let qCount = 1;
          for (const res of pageAnalysisResults) {
            // 새로운 메타데이터가 발견되면 업데이트 (전방 계승의 핵심)
            if (res.metadata) {
              if (res.metadata.year) currentMetadata.year = res.metadata.year;
              if (res.metadata.term) currentMetadata.term = res.metadata.term;
              if (res.metadata.type) currentMetadata.type = res.metadata.type;
              if (res.metadata.grade) currentMetadata.grade = res.metadata.grade;
              
              // 파일 전체 메타데이터로도 활용 (첫 번째 발견된 것 기준)
              if (!examYear) examYear = currentMetadata.year;
              if (!examTerm) examTerm = currentMetadata.term;
              if (!examType) examType = currentMetadata.type;
              if (!examGrade) examGrade = currentMetadata.grade;
            }

            if (res.questions && res.questions.length > 0) {
              for (const q of res.questions) {
                const year = currentMetadata.year || "미상";
                const term = currentMetadata.term || "미상";
                const type = currentMetadata.type || "미상";
                const id = `[${year}-${term}-${type}-Q${String(qCount).padStart(2, '0')}]`;
                
                allQuestions.push({
                  id,
                  questionText: q.questionText
                });
                qCount++;
              }
            }
          }
          
          if (allQuestions.length > 0) {
            parsedQuestions = allQuestions;
          }
        }

        const newFile = {
          id: fileId,
          subjectId,
          name: file.name,
          content: fullText,
          category,
          createdAt: Date.now(),
          examYear,
          examTerm,
          examType,
          examGrade,
          parsedQuestions,
        };

        await saveSubjectFile(newFile);
        if (subjectPages.length > 0) {
          await saveSubjectPages(subjectPages);
          await clusterFileLocally(fileId, subjectPages, [], parsedQuestions || []);
        } else if (segments.length > 0) {
          await clusterFileLocally(fileId, [], segments, parsedQuestions || []);
        }

        updateTask(taskId, { progress: '완료', status: 'done' });
        setLastCompletedAt(Date.now());
        
        // Remove task after 3 seconds
        setTimeout(() => {
          setTasks(prev => prev.filter(t => t.id !== taskId));
        }, 3000);

      } catch (err: any) {
        updateTask(taskId, { status: 'error', error: err.message || "파일 업로드 중 오류가 발생했습니다." });
      }
    }
  };

  const removeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  return (
    <UploadContext.Provider value={{ tasks, uploadFiles, removeTask, lastCompletedAt }}>
      {children}
    </UploadContext.Provider>
  );
};
