import React, { useState, useEffect } from 'react';
import { Subject, Gallery, ConceptPost, getSubject, getGalleriesBySubject, getPostsByGallery, getSubjectPages, savePosts, getSubjectFiles, deleteSubjectCurriculum, saveGalleries, getSubjectSegments, SubjectPage, SubjectSegment, StudyUnit } from '../lib/db';
import { generatePostsForGallery as generatePostsForGalleryService } from '../lib/postService';
import { getPersonaPrompt } from '../lib/persona';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { ChevronRight, ChevronDown, BookOpen, FileText, CheckCircle2, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { ConceptPostView } from './ConceptPostView';
import { QuizView } from './QuizView';
import { ExamList } from './ExamList';
import { ExamView } from './ExamView';
import { StudyModeSelector } from './StudyModeSelector';
import { useStudyMode } from '../contexts/StudyModeContext';
import { ExamSession } from '../lib/db';

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
  const [activeExamSession, setActiveExamSession] = useState<ExamSession | null>(null);
  const [activeTab, setActiveTab] = useState<'STUDY' | 'EXAM'>('STUDY');
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

  // 1. [AI Architect] 개념글 목차(뼈대) 생성
  async function generateConceptPostOutline(gallery: Gallery, subjectId: string): Promise<any[]> {
    const s = await getSubject(subjectId);
    const personaMode = s?.personaMode;
    const customPersona = s?.customPersona;

    const outlinePrompt = `
선택한 갤러리: [${gallery.galleryId}] ${gallery.title} - ${gallery.description}
이 갤러리의 학습 목표를 달성하기 위한 개념글(소주제) 목차를 생성하라.
${getPersonaPrompt(personaMode, customPersona)}

출력 형식: JSON 배열 (각 항목은 { heading: string, description: string, requiredConcepts: string[] })
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: outlinePrompt,
      config: { responseMimeType: 'application/json' }
    });
    if (!response.text) throw new Error("목차 생성 실패");
    return JSON.parse(response.text);
  }

  // 2. [System Builder] 내용 매핑 (텍스트 유사도 기반)
  async function mapContentToOutline(outline: any[], relevantUnits: StudyUnit[], allPages: SubjectPage[], allSegments: SubjectSegment[]): Promise<ConceptPost[]> {
    // 텍스트 데이터 맵 생성
    const textMap = new Map<string, string>();
    allPages.forEach(p => textMap.set(`${p.fileId}:${p.pageNumber}`, p.text));
    allSegments.forEach(s => textMap.set(s.id, s.text));

    return Promise.all(outline.map(async (section: any, index: number) => {
      // 섹션의 핵심 키워드 및 설명
      const sectionText = `${section.heading} ${section.description} ${section.requiredConcepts.join(' ')}`.toLowerCase();
      
      // 관련 자료 중 유사도 높은 유닛 매핑
      const mappedUnits = relevantUnits.filter(unit => {
        const unitId = unit.type === 'PAGE' ? unit.id : unit.id;
        const unitText = textMap.get(unitId)?.toLowerCase() || '';
        if (!unitText) return false;
        
        const score = calculateSimilarity(sectionText, unitText);
        return score >= 0.05; // 임계값 (텍스트 유사도)
      });

      // 3. [Synthesizer] 상세 내용 생성
      const content = await generateConceptPostContent(section, mappedUnits, allPages, allSegments);

      return {
        id: crypto.randomUUID(),
        galleryId: '',
        postId: '',
        title: section.heading,
        description: section.description,
        isQuiz: false,
        content: content,
        mappedMaterials: mappedUnits, // 매핑된 자료 저장
        createdAt: Date.now(),
      };
    }));
  }

  // [Synthesizer] 상세 내용 생성 함수
  async function generateConceptPostContent(section: any, mappedUnits: StudyUnit[], allPages: SubjectPage[], allSegments: SubjectSegment[]): Promise<string> {
    const textMap = new Map<string, string>();
    allPages.forEach(p => textMap.set(`${p.fileId}:${p.pageNumber}`, p.text));
    allSegments.forEach(s => textMap.set(s.id, s.text));

    const materialText = mappedUnits.map(u => textMap.get(u.id) || '').join('\n\n');
    
    const prompt = `당신은 대학 전공 과목의 개념글을 작성하는 전문가입니다.
제공된 학습 자료를 바탕으로, '${section.heading}'에 대한 상세 개념글을 작성하세요.

[학습 자료]
${materialText}

[지시사항]
1. 제공된 학습 자료를 기반으로 상세하고 이해하기 쉽게 작성하세요.
2. 마크다운 형식으로 작성하세요.
3. 핵심 개념을 명확히 설명하세요.
4. 불필요한 서론/결론은 생략하고 핵심 내용 위주로 작성하세요.`;

    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
    });
    return res.text || "내용 생성 실패";
  }

  // 간단한 유사도 계산 함수
  function calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    return intersection.size / Math.max(words1.size, words2.size);
  }

  const generatePostsForGallery = async (gallery: Gallery, subjectId: string): Promise<ConceptPost[]> => {
    if (generatingGalleries.has(gallery.id)) return [];
    
    setGeneratingGalleries(prev => new Set(prev).add(gallery.id));
    
    try {
      setGenerationStatus("개념글 생성 중...");
      const posts = await generatePostsForGalleryService(gallery, subjectId);
      
      setPostsByGallery(prev => ({ ...prev, [gallery.id]: posts }));
      setGenerationStatus(null);
      return posts;
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

  // 1. [AI Architect] 갤러리 뼈대 생성
  async function generateGallerySkeleton(subjectId: string, combinedText: string): Promise<any[]> {
    const s = await getSubject(subjectId);
    const personaMode = s?.personaMode;
    const customPersona = s?.customPersona;
    const settings = s?.studyModeSettings;

    const prompt = `당신은 대학 전공 과목의 커리큘럼을 설계하는 전문가입니다.
제공된 학습 자료를 바탕으로, 전체 시험 범위를 정의하는 '마스터 갤러리 구조(뼈대)'를 생성하세요.

[페르소나 설정]
${getPersonaPrompt(personaMode, customPersona)}

[해석 모드 설정]
- 기출문제: ${settings?.exam || 'ACTIVE'}
- 강의자료: ${settings?.lecture || 'ACTIVE'}
- 녹음본: ${settings?.recording || 'ACTIVE'}

지시사항:
1. 학습 자료를 분석하여 논리적 흐름에 따라 갤러리(대주제)들을 생성하세요.
2. 각 갤러리에는 title, description, scopeDescription(범위 정의 및 핵심 키워드)을 상세히 작성하세요.
3. relevantUnits는 반드시 빈 배열([])로 생성하세요.
4. JSON 형식으로만 응답하세요.

학습 자료:
${combinedText}

JSON 형식:
{
  "galleries": [
    {
      "title": "갤러리 제목",
      "description": "갤러리 설명",
      "scopeDescription": "범위 정의 및 핵심 키워드",
      "relevantUnits": []
    }
  ]
}`;

    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    if (!res.text) throw new Error("AI 응답이 없습니다.");
    return JSON.parse(res.text).galleries;
  }

  // 2. [System Builder] 갤러리 매핑
  async function mapUnitsToGalleries(galleries: any[], allPages: SubjectPage[], allSegments: SubjectSegment[], allQuestions: any[]): Promise<Gallery[]> {
    const embeddingMap = new Map<string, number[]>();
    allPages.forEach(p => embeddingMap.set(`${p.fileId}:${p.pageNumber}`, p.embedding));
    // segments/questions도 동일하게 매핑 필요

    return galleries.map((g, index) => {
      // 갤러리 벡터 생성 (scopeDescription 기반)
      // 실제 구현에서는 갤러리 벡터를 생성하는 로직이 필요합니다.
      
      return {
        id: crypto.randomUUID(),
        subjectId: '', // 나중에 설정
        galleryId: `G${String(index + 1).padStart(2, '0')}`,
        title: g.title,
        description: g.description,
        pastExams: '', // 필요시 추가
        relevantUnits: [], // 시스템 매핑 결과 할당
        createdAt: Date.now()
      };
    });
  }

  const generateCurriculum = async () => {
    setIsGeneratingCurriculum(true);
    setLoadingMessage('커리큘럼 설계 중...');
    
    try {
      const subjectFiles = await getSubjectFiles(subjectId);
      const allPages = await getSubjectPages(subjectId);
      
      let combinedText = '';
      allPages.forEach(p => {
        combinedText += `\n\n[Page ${p.pageNumber}]\n${p.text}`;
      });

      // 1. [AI Architect] 뼈대 생성
      setLoadingMessage('갤러리 뼈대 설계 중...');
      const skeleton = await generateGallerySkeleton(subjectId, combinedText);

      // 2. [System Builder] 매핑
      setLoadingMessage('학습 자료 매핑 중...');
      const newGalleries = await mapUnitsToGalleries(skeleton, allPages, [], []); // segments, questions 추가 필요
      
      const finalGalleries = newGalleries.map(g => ({ ...g, subjectId }));

      await deleteSubjectCurriculum(subjectId);
      await saveGalleries(finalGalleries);
      
      await loadCurriculum();
      setGenerationStatus("✅ 커리큘럼이 성공적으로 생성되었습니다!");
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
          
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800">
            <button 
              onClick={() => setActiveTab('STUDY')}
              className={`pb-2 px-2 font-bold text-sm ${activeTab === 'STUDY' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-neutral-500'}`}
            >
              학습
            </button>
            <button 
              onClick={() => setActiveTab('EXAM')}
              className={`pb-2 px-2 font-bold text-sm ${activeTab === 'EXAM' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-neutral-500'}`}
            >
              기출문제
            </button>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
              <BookOpen size={18} className="text-blue-600 dark:text-blue-400" />
              {activeTab === 'STUDY' ? '커리큘럼' : '기출문제 세트'}
            </h2>
            {activeTab === 'STUDY' && (
              <button
                onClick={() => setShowConfirmReconstruct(true)}
                className="text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-2 py-1 rounded transition-colors"
              >
                재구성
              </button>
            )}
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
          {activeTab === 'STUDY' ? (
            galleries.map(gallery => {
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
            })
          ) : (
            <ExamList subjectId={subjectId} onSelectSession={setActiveExamSession} />
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden flex flex-col relative transition-colors duration-200">
        {activeTab === 'EXAM' ? (
          activeExamSession ? (
            <ExamView session={activeExamSession} onUpdate={setActiveExamSession} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400">기출문제를 선택해주세요.</div>
          )
        ) : activePost ? (
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
