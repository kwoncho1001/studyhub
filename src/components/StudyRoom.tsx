import React, { useState, useEffect } from 'react';
import { Subject, Gallery, ConceptPost, getSubject, getGalleriesBySubject, getPostsByGallery, getSubjectPages, savePosts, getSubjectFiles, deleteSubjectCurriculum, saveGalleries } from '../lib/db';
import { getPersonaPrompt } from '../lib/persona';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { ChevronRight, ChevronDown, BookOpen, FileText, CheckCircle2, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { ConceptPostView } from './ConceptPostView';
import { QuizView } from './QuizView';
import { StudyModeSelector } from './StudyModeSelector';
import { useStudyMode } from '../contexts/StudyModeContext';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface StudyRoomProps {
  subjectId: string;
  onEditSubject: (subjectId: string) => void;
}

export function StudyRoom({ subjectId, onEditSubject }: StudyRoomProps) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [postsByGallery, setPostsByGallery] = useState<Record<string, ConceptPost[]>>({});
  const [expandedGalleries, setExpandedGalleries] = useState<Set<string>>(new Set());
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [isGeneratingCurriculum, setIsGeneratingCurriculum] = useState(false);
  const [showConfirmReconstruct, setShowConfirmReconstruct] = useState(false);
  const [generatingGalleries, setGeneratingGalleries] = useState<Set<string>>(new Set());
  const [showCoverage, setShowCoverage] = useState(false);
  const [allQuestions, setAllQuestions] = useState<{ id: string, text: string }[]>([]);
  const { getSettings } = useStudyMode();
  const settings = getSettings(subjectId);

  // Flattened posts for easy navigation and pre-fetching
  const [flattenedPosts, setFlattenedPosts] = useState<ConceptPost[]>([]);

  useEffect(() => {
    loadCurriculum();
  }, [subjectId]);

  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const files = await getSubjectFiles(subjectId);
        const questions: { id: string, text: string }[] = [];
        files.forEach(f => {
          if (f.category === 'EXAM' && f.parsedQuestions) {
            f.parsedQuestions.forEach(q => {
              questions.push({ id: q.id, text: q.questionText });
            });
          }
        });
        setAllQuestions(questions);
      } catch (e) {
        console.error("Failed to fetch questions for coverage", e);
      }
    };
    fetchQuestions();
  }, [subjectId, galleries, isGeneratingCurriculum]);

  const generatePostsForGallery = async (gallery: Gallery, subjectId: string): Promise<ConceptPost[]> => {
    if (generatingGalleries.has(gallery.id)) return [];
    
    setGeneratingGalleries(prev => new Set(prev).add(gallery.id));
    
    try {
      const s = await getSubject(subjectId);
      const personaMode = s?.personaMode;
      const customPersona = s?.customPersona;

      const allPages = await getSubjectPages(subjectId);
      const files = await getSubjectFiles(subjectId);
      
      // 1. [AI 기반 개념글 목차(뼈대) 생성]
      setGenerationStatus("개념글 목차 설계 중...");
      const outlinePrompt = `
선택한 갤러리: [${gallery.galleryId}] ${gallery.title} - ${gallery.description}
이 갤러리의 학습 목표를 달성하기 위한 개념글(소주제) 목차를 생성하라.
${getPersonaPrompt(personaMode, customPersona)}

출력 형식: JSON 배열 (각 항목은 { heading: string, description: string, requiredConcepts: string[] })
`;

      const outlineResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: outlinePrompt,
        config: { responseMimeType: 'application/json' }
      });
      if (!outlineResponse.text) throw new Error("목차 생성 실패");
      const sections = JSON.parse(outlineResponse.text);

      // 2. [시스템 기반 내용 매핑]
      setGenerationStatus("학습 자료 매핑 중...");
      
      // 관련 자료 텍스트 준비
      const relevantUnits = gallery.relevantUnits || [];
      const unitContents = allPages
        .filter(p => relevantUnits.some(u => u.type === 'PAGE' && u.id === `${p.fileId}:${p.pageNumber}`))
        .map(p => ({ type: 'PAGE' as const, id: `${p.fileId}:${p.pageNumber}`, text: p.text }));

      // 섹션별 매핑
      const mappedSections = sections.map((section: any) => {
        const sectionText = `${section.heading} ${section.description} ${section.requiredConcepts.join(' ')}`.toLowerCase();
        
        // 유사도 기반 매핑
        const mappedUnits = unitContents.filter(unit => {
          const score = calculateSimilarity(sectionText, unit.text.toLowerCase());
          return score >= 0.1; // 임계값
        });

        return {
          ...section,
          content: `## ${section.heading}\n${section.description}\n\n참고 자료:\n${mappedUnits.map(u => u.text).join('\n\n')}`
        };
      });

      // 개념글 객체 생성
      const newPosts: ConceptPost[] = mappedSections.map((s: any, index: number) => ({
        id: crypto.randomUUID(),
        galleryId: gallery.id,
        postId: `${gallery.galleryId}-P${String(index + 1).padStart(2, '0')}`,
        title: s.heading,
        description: s.description,
        isQuiz: false,
        content: s.content,
        createdAt: Date.now(),
      }));

      await savePosts(newPosts);
      
      setPostsByGallery(prev => ({ ...prev, [gallery.id]: newPosts }));
      setGenerationStatus(null);
      return newPosts;
    } catch (e) {
      console.error("Failed to generate posts for gallery", gallery.title, e);
      setGenerationStatus(null);
    } finally {
      setGeneratingGalleries(prev => {
        const next = new Set(prev);
        next.delete(gallery.id);
        return next;
      });
    }
    return [];
  };

  // 간단한 유사도 계산 함수 (clustering.ts와 동일)
  function calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    return intersection.size / Math.max(words1.size, words2.size);
  }

  const generateCurriculum = async () => {
    setIsGeneratingCurriculum(true);
    setLoadingMessage('1차 커리큘럼 설계 중...');
    
    try {
      const subjectFiles = await getSubjectFiles(subjectId);
      if (subjectFiles.length === 0) {
        // 새 과목 추가 시 예외 처리: 파일이 없으면 과목 편집(자료실)으로 이동
        alert("학습 자료가 없습니다. 자료를 먼저 업로드해주세요.");
        onEditSubject(subjectId);
        setIsGeneratingCurriculum(false);
        return;
      }

      // 1. 파일 텍스트 취합 (페이지 마킹 포함) 및 기출문제 데이터 취합
      let combinedText = '';
      let allExamIds: string[] = [];
      let examContext = '';

      // 파일별로 페이지를 구분하여 텍스트 구성
      const allPages = await getSubjectPages(subjectId);
      const filesMap: Record<string, any> = {};
      subjectFiles.forEach(f => filesMap[f.id] = f);

      allPages.forEach(p => {
        const file = p.fileId ? filesMap[p.fileId] : null;
        const category = file ? file.category : '기타';
        const fileName = file ? file.name : '알 수 없음';
        const fileId = file ? file.id : 'unknown';
        combinedText += `\n\n[자료ID: ${fileId}] [파일명: ${fileName}] [카테고리: ${category}] [Page ${p.pageNumber}]\n${p.text}`;
      });

      subjectFiles.forEach(f => {
        if (f.category === 'EXAM' && f.parsedQuestions) {
          f.parsedQuestions.forEach(q => {
            allExamIds.push(q.id);
            examContext += `\n- ID: ${q.id} | 문제: ${q.questionText}`;
          });
        }
      });

      const maxAttempts = 3;
      let attempt = 0;
      let isValid = false;
      let feedbackHistory = '';
      let finalGalleries: any[] = [];

      while (attempt < maxAttempts && !isValid) {
        attempt++;
        setLoadingMessage(`커리큘럼 설계 중... (시도 ${attempt}/${maxAttempts})`);

        const prompt = `당신은 대학 전공 과목의 커리큘럼을 설계하는 전문가입니다.
제공된 학습 자료와 기출문제를 바탕으로, 사용자가 시험에서 만점을 받을 수 있도록 돕는 전략적 커리큘럼을 설계하세요.

[대원칙: 근거 중심의 역설계]
1. 모든 갤러리는 제공된 학습 자료의 특정 페이지들에 반드시 근거해야 합니다.
2. 기출문제를 먼저 분석하여, 각 문제를 풀기 위해 반드시 알아야 하는 핵심 개념들을 도출하세요.
3. 도출된 개념들을 논리적 흐름에 따라 체계적으로 분류하여 갤러리(대주제)들을 생성하세요.
4. 각 갤러리에는 해당 내용을 담고 있는 학습 자료의 유닛(자료ID와 페이지 번호 쌍)들을 'relevantUnits' 배열에 반드시 포함시켜야 합니다.

[해석 모드 설정]
- 기출문제: ${settings.exam === 'PASSIVE' ? '선별 모드 (Selective)' : settings.exam === 'ACTIVE' ? '기준 모드 (Core)' : '보조 모드 (Supplement)'}
- 강의자료: ${settings.lecture === 'PASSIVE' ? '선별 모드 (Selective)' : settings.lecture === 'ACTIVE' ? '기준 모드 (Core)' : '보조 모드 (Supplement)'}
- 녹음본: ${settings.recording === 'PASSIVE' ? '선별 모드 (Selective)' : settings.recording === 'ACTIVE' ? '기준 모드 (Core)' : '보조 모드 (Supplement)'}

${feedbackHistory ? `\n이전 생성 결과에 대한 피드백 (반드시 반영할 것):\n${feedbackHistory}\n` : ''}

학습 자료 (페이지 마킹됨):
${combinedText}

기출문제 정보:
${examContext}

지시사항:
1. 제공된 모든 기출문제 ID(${allExamIds.join(', ')})는 누락 없이 어딘가의 갤러리에 반드시 매핑되어야 합니다.
2. 각 갤러리에는 관련된 기출문제 ID를 'mappedExamIds' 배열에 포함시키세요.
3. 각 갤러리가 학습 자료의 어느 부분을 참고해야 하는지 'relevantUnits'에 { "type": "PAGE", "id": "자료ID:페이지번호" } 형식의 객체 배열로 명시하세요. (예: { "type": "PAGE", "id": "uuid-123:1" })
4. JSON 형식으로만 응답하세요.

JSON 형식:
{
  "galleries": [
    {
      "galleryId": "G01",
      "title": "갤러리 제목",
      "description": "갤러리에서 다루는 핵심 내용 및 학습 목표",
      "pastExams": "관련 기출문제 요약",
      "mappedExamIds": ["기출문제 ID 1"],
      "relevantUnits": [
        { "type": "PAGE", "id": "자료ID:페이지번호" }
      ]
    }
  ]
}`;

        const res = await ai.models.generateContent({
          model: 'gemini-2.5-flash-lite', // 사용자의 요청에 따라 Gemini 2.5 Flash Lite 사용
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                galleries: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      galleryId: { type: Type.STRING },
                      title: { type: Type.STRING },
                      description: { type: Type.STRING },
                      pastExams: { type: Type.STRING },
                      mappedExamIds: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                      },
                    relevantUnits: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          type: { type: Type.STRING, enum: ['PAGE', 'SEGMENT', 'QID'] },
                          id: { type: Type.STRING }
                        },
                        required: ['type', 'id']
                      }
                    }
                  },
                  required: ['galleryId', 'title', 'description', 'mappedExamIds', 'relevantUnits']
                  }
                }
              },
              required: ['galleries']
            }
          }
        });

        if (!res.text) throw new Error("AI 응답이 없습니다.");
        const parsed = JSON.parse(res.text);
        finalGalleries = parsed.galleries;

        if (finalGalleries.length === 0) {
          feedbackHistory += `\n[시도 ${attempt} 피드백]\n갤러리가 생성되지 않았습니다. 최소 3개 이상의 갤러리를 생성하세요.`;
          continue;
        }

        setLoadingMessage(`기출문제 누락 및 구조 검토 중... (시도 ${attempt}/${maxAttempts})`);

        // 결정론적 검증 (코드 기반)
        const mappedIds = new Set<string>();
        finalGalleries.forEach(g => {
          (g.mappedExamIds || []).forEach((id: string) => mappedIds.add(id));
        });

        const missingIds = allExamIds.filter(id => !mappedIds.has(id));
        let deterministicFeedback = '';
        if (missingIds.length > 0) {
          deterministicFeedback = `[시스템 검증 실패] 다음 기출문제 ID가 어떤 갤러리에도 매핑되지 않았습니다: ${missingIds.join(', ')}. 모든 기출문제를 반드시 매핑하세요.`;
        }

        // AI 검증
        const validatorPrompt = `당신은 커리큘럼 보안 및 품질 검토자입니다.
생성된 갤러리 구조가 다음 '기출 정복' 기준을 완벽하게 만족하는지 엄격하게 검토하세요.

[검토 기준]
1. 기출문제 커버리지: 제공된 모든 기출문제 ID(${allExamIds.join(', ')})가 적절한 갤러리에 매핑되었는가?
2. 내용의 깊이: 기출문제가 매핑된 갤러리의 설명이 해당 문제를 풀기에 충분히 구체적이고 깊이 있는가?
3. 누락 방지: 학습 자료의 방대한 내용 중 시험에 나올 법한 중요한 개념이 누락되지 않고 체계적으로 분류되었는가?

생성된 갤러리:
${JSON.stringify(finalGalleries, null, 2)}

${deterministicFeedback ? `시스템 피드백 (치명적 오류):\n${deterministicFeedback}\n` : ''}

JSON 형식으로 응답:
{
  "isValid": boolean (시스템 피드백이 있거나 기출문제 누락이 있으면 무조건 false),
  "feedback": "수정이 필요한 경우 구체적인 피드백 (어떤 기출문제를 위해 어떤 갤러리를 보강해야 하는지)"
}`;

        const validatorRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash-lite',
          contents: validatorPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isValid: { type: Type.BOOLEAN },
                feedback: { type: Type.STRING }
              },
              required: ['isValid', 'feedback']
            }
          }
        });

        const validatorParsed = JSON.parse(validatorRes.text || "{}");
        
        if (validatorParsed.isValid && missingIds.length === 0) {
          isValid = true;
        } else {
          feedbackHistory += `\n[시도 ${attempt} 피드백]\n${deterministicFeedback}\n${validatorParsed.feedback}`;
        }
      }

      if (finalGalleries.length === 0) {
        throw new Error("커리큘럼 생성에 실패했습니다. 다시 시도해주세요.");
      }

      setLoadingMessage('기존 커리큘럼 삭제 및 저장 중...');

      // 2. 기존 갤러리 삭제 (성공했을 때만 삭제)
      await deleteSubjectCurriculum(subjectId);

      // 3. 갤러리 저장
      const newGalleries: Gallery[] = finalGalleries.map((g: any, index: number) => ({
        id: crypto.randomUUID(),
        subjectId,
        galleryId: g.galleryId || `G${String(index + 1).padStart(2, '0')}`,
        title: g.title,
        description: g.description,
        pastExams: g.pastExams,
        mappedExamIds: g.mappedExamIds || [],
        relevantPages: g.relevantPages || [],
        relevantUnits: g.relevantUnits || [],
        order: index,
        createdAt: Date.now()
      }));

      await saveGalleries(newGalleries);
      
      // Reload curriculum after generating galleries
      await loadCurriculum();

      // Final Coverage Summary Alert
      const finalMappedIds = new Set<string>();
      newGalleries.forEach(g => (g.mappedExamIds || []).forEach(id => finalMappedIds.add(id)));
      const finalMissing = allExamIds.filter(id => !finalMappedIds.has(id));
      
      if (finalMissing.length === 0) {
        setGenerationStatus("✅ 모든 기출문제가 커리큘럼에 완벽하게 반영되었습니다!");
      } else {
        setGenerationStatus(`⚠️ ${finalMissing.length}개의 기출문제가 누락되었습니다. 사이드바의 '기출 반영 현황'을 확인해주세요.`);
      }
      setTimeout(() => setGenerationStatus(null), 5000);
    } catch (err: any) {
      console.error("Failed to generate curriculum", err);
      alert("커리큘럼 생성 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsGeneratingCurriculum(false);
    }
  };

  const generateRemainingGalleries = async (gList: Gallery[], currentPMap: Record<string, ConceptPost[]>) => {
    for (let i = 1; i < gList.length; i++) {
      const g = gList[i];
      if (!currentPMap[g.id] || currentPMap[g.id].length === 0) {
        const pList = await generatePostsForGallery(g, subjectId);
        if (pList.length > 0) {
          setPostsByGallery(prev => {
            const next = { ...prev, [g.id]: pList };
            const newFlat: ConceptPost[] = [];
            for (const gal of gList) {
              if (next[gal.id]) newFlat.push(...next[gal.id]);
            }
            setFlattenedPosts(newFlat);
            return next;
          });
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  };

  const loadCurriculum = async () => {
    setLoading(true);
    setLoadingMessage('커리큘럼을 불러오는 중입니다...');
    const s = await getSubject(subjectId);
    if (s) setSubject(s);

    let gList = await getGalleriesBySubject(subjectId);
    
    if (gList.length === 0) {
      await generateCurriculum();
      return;
    }

    setGalleries(gList);

    const pMap: Record<string, ConceptPost[]> = {};
    
    // Check 1st gallery
    const firstGallery = gList[0];
    const firstPList = await getPostsByGallery(firstGallery.id);
    pMap[firstGallery.id] = firstPList;

    if (firstPList.length === 0) {
      setLoadingMessage('첫 번째 갤러리 개념글 생성 중...');
      const generated = await generatePostsForGallery(firstGallery, subjectId);
      pMap[firstGallery.id] = generated;
    }

    // Load other existing posts without generating
    for (let i = 1; i < gList.length; i++) {
      const g = gList[i];
      const pList = await getPostsByGallery(g.id);
      pMap[g.id] = pList;
    }

    setPostsByGallery(pMap);
    
    const initialFlat: ConceptPost[] = [];
    for (const g of gList) {
      if (pMap[g.id]) initialFlat.push(...pMap[g.id]);
    }
    setFlattenedPosts(initialFlat);
    
    if (gList.length > 0) {
      setExpandedGalleries(new Set([gList[0].id]));
      if (pMap[gList[0].id]?.length > 0) {
        setActivePostId(pMap[gList[0].id][0].id);
      }
    }
    setLoading(false);

    // Background generation for the rest
    generateRemainingGalleries(gList, pMap);
  };

  const toggleGallery = async (galleryId: string) => {
    const isExpanding = !expandedGalleries.has(galleryId);
    
    setExpandedGalleries(prev => {
      const next = new Set(prev);
      if (next.has(galleryId)) next.delete(galleryId);
      else next.add(galleryId);
      return next;
    });

    if (isExpanding) {
      const posts = postsByGallery[galleryId] || [];
      if (posts.length === 0 && !generatingGalleries.has(galleryId)) {
        const gallery = galleries.find(g => g.id === galleryId);
        if (gallery) {
          const pList = await generatePostsForGallery(gallery, subjectId);
          if (pList.length > 0) {
            setPostsByGallery(prev => {
              const next = { ...prev, [galleryId]: pList };
              const newFlat: ConceptPost[] = [];
              for (const gal of galleries) {
                if (next[gal.id]) newFlat.push(...next[gal.id]);
              }
              setFlattenedPosts(newFlat);
              return next;
            });
          }
        }
      }
    }
  };

  if (loading || isGeneratingCurriculum) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Loader2 className="animate-spin text-blue-600 dark:text-blue-400" size={40} />
        <p className="text-neutral-600 dark:text-neutral-400 font-medium animate-pulse transition-colors duration-200">{loadingMessage}</p>
        {generationStatus && (
          <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-2">{generationStatus}</p>
        )}
      </div>
    );
  }

  const activePost = flattenedPosts.find(p => p.id === activePostId);
  const activePostIndex = flattenedPosts.findIndex(p => p.id === activePostId);
  const nextPost = activePostIndex >= 0 && activePostIndex < flattenedPosts.length - 1 ? flattenedPosts[activePostIndex + 1] : null;

  const mappedIds = new Set<string>();
  galleries.forEach(g => {
    (g.mappedExamIds || []).forEach(id => mappedIds.add(id));
  });

  const coverageCount = allQuestions.filter(q => mappedIds.has(q.id)).length;
  const coveragePercent = allQuestions.length > 0 ? Math.round((coverageCount / allQuestions.length) * 100) : 0;
  const missingQuestions = allQuestions.filter(q => !mappedIds.has(q.id));

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden flex flex-col transition-colors duration-200">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 transition-colors duration-200 flex flex-col gap-3">
          <StudyModeSelector subjectId={subjectId} />
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
              <BookOpen size={18} className="text-blue-600 dark:text-blue-400" />
              커리큘럼
            </h2>
            <button
              onClick={() => setShowConfirmReconstruct(true)}
              className="text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-2 py-1 rounded transition-colors"
            >
              재구성
            </button>
          </div>

          {/* Traceability Matrix Summary */}
          {allQuestions.length > 0 && (
            <div 
              className="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-2 cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => setShowCoverage(!showCoverage)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">기출 반영 현황</span>
                <span className={`text-[10px] font-bold ${coveragePercent === 100 ? 'text-green-600' : 'text-orange-600'}`}>
                  {coveragePercent}% ({coverageCount}/{allQuestions.length})
                </span>
              </div>
              <div className="w-full bg-neutral-100 dark:bg-neutral-700 h-1.5 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${coveragePercent === 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${coveragePercent}%` }}
                />
              </div>
              {missingQuestions.length > 0 && (
                <div className="mt-1 flex items-center gap-1 text-[9px] text-red-500 font-medium">
                  <AlertCircle size={10} />
                  <span>{missingQuestions.length}개 문제 누락됨</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coverage Detail Overlay */}
        {showCoverage && (
          <div className="absolute inset-0 z-50 bg-white dark:bg-neutral-900 flex flex-col p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100">기출문제 반영 상세</h3>
              <button 
                onClick={() => setShowCoverage(false)}
                className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-2">
              {allQuestions.map(q => {
                const isMapped = mappedIds.has(q.id);
                const mappedGallery = galleries.find(g => g.mappedExamIds?.includes(q.id));
                return (
                  <div key={q.id} className="p-2 rounded-lg border border-neutral-100 dark:border-neutral-800 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-neutral-400">{q.id}</span>
                      {isMapped ? (
                        <span className="flex items-center gap-1 text-green-600 font-bold">
                          <CheckCircle size={10} /> 반영됨
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 font-bold">
                          <AlertCircle size={10} /> 누락
                        </span>
                      )}
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 line-clamp-2">{q.text}</p>
                    {isMapped && mappedGallery && (
                      <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                        → {mappedGallery.title}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {galleries.map(gallery => {
            const isExpanded = expandedGalleries.has(gallery.id);
            const posts = postsByGallery[gallery.id] || [];
            
            return (
              <div key={gallery.id} className="space-y-1">
                <button
                  onClick={() => toggleGallery(gallery.id)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-left transition-colors"
                >
                  {isExpanded ? <ChevronDown size={16} className="text-neutral-500 dark:text-neutral-400" /> : <ChevronRight size={16} className="text-neutral-500 dark:text-neutral-400" />}
                  <span className="font-semibold text-sm text-neutral-800 dark:text-neutral-200 line-clamp-1 flex-1">{gallery.title}</span>
                </button>
                
                {isExpanded && (
                  <div className="pl-6 space-y-1">
                    {posts.map(post => {
                      const isActive = post.id === activePostId;
                      return (
                        <button
                          key={post.id}
                          onClick={() => setActivePostId(post.id)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm transition-colors ${
                            isActive ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400'
                          }`}
                        >
                          {post.isQuiz ? (
                            <CheckCircle2 size={16} className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-500'} />
                          ) : (
                            <FileText size={16} className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400 dark:text-neutral-500'} />
                          )}
                          <span className="line-clamp-1">{post.title}</span>
                        </button>
                      );
                    })}
                    {generatingGalleries.has(gallery.id) && (
                      <div className="flex items-center gap-2 p-2 text-xs text-neutral-400 animate-pulse">
                        <Loader2 size={14} className="animate-spin" />
                        <span>개념글 생성 중...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden flex flex-col relative transition-colors duration-200">
        {activePost ? (
          activePost.isQuiz ? (
            <QuizView 
              key={activePost.id}
              post={activePost} 
              subjectId={subjectId}
              onUpdate={(updatedPost) => {
                setFlattenedPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
                setPostsByGallery(prev => {
                  const next = { ...prev };
                  next[updatedPost.galleryId] = next[updatedPost.galleryId].map(p => p.id === updatedPost.id ? updatedPost : p);
                  return next;
                });
              }}
            />
          ) : (
            <ConceptPostView 
              key={activePost.id}
              post={activePost} 
              subjectId={subjectId} 
              nextPost={nextPost}
              onUpdate={(updatedPost) => {
                setFlattenedPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
                setPostsByGallery(prev => {
                  const next = { ...prev };
                  next[updatedPost.galleryId] = next[updatedPost.galleryId].map(p => p.id === updatedPost.id ? updatedPost : p);
                  return next;
                });
              }}
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 transition-colors duration-200">
            학습할 개념글을 선택해주세요.
          </div>
        )}
      </div>

      {/* Reconstruct Confirmation Modal */}
      {showConfirmReconstruct && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 border border-neutral-200 dark:border-neutral-800">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">커리큘럼 재구성</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                커리큘럼을 재구성하시겠습니까? 기존 갤러리와 개념글이 모두 삭제되며, AI가 자료를 다시 분석하여 새로운 목차를 생성합니다.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowConfirmReconstruct(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowConfirmReconstruct(false);
                  generateCurriculum();
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
              >
                재구성 시작
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
