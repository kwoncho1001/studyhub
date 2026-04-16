import { useState, useEffect } from 'react';
import { Gallery, ConceptPost, getGallery, getSubject, getPostsByGallery, savePosts, getSubjectPages, getSubjectFiles } from '../lib/db';
import { getPersonaPrompt } from '../lib/persona';
import { GoogleGenAI, Type } from '@google/genai';
import { motion } from 'motion/react';
import { Loader2, PlayCircle, BookOpen } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface GalleryViewProps {
  galleryId: string;
}

export function GalleryView({ galleryId }: GalleryViewProps) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [posts, setPosts] = useState<ConceptPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [galleryId]);

  const loadData = async () => {
    const g = await getGallery(galleryId);
    if (g) {
      setGallery(g);
    }
    const p = await getPostsByGallery(galleryId);
    setPosts(p);
  };

  const handleGeneratePosts = async () => {
    if (!gallery) return;
    const subject = await getSubject(gallery.subjectId);
    if (!subject) {
      setError('과목 정보를 찾을 수 없습니다.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // 1. Fetch all pages
      const allPages = await getSubjectPages(subject.id);
      let targetPages = [];

      // 2. Filter pages based on gallery's relevantUnits or relevantPages
      if (gallery.relevantUnits && gallery.relevantUnits.length > 0) {
        targetPages = allPages.filter(p => 
          gallery.relevantUnits!.some(u => u.type === 'PAGE' && u.id === `${p.fileId}:${p.pageNumber}`)
        );
      } else if (gallery.relevantPages && gallery.relevantPages.length > 0 && allPages.length > 0) {
        targetPages = allPages.filter(p => gallery.relevantPages!.includes(p.pageNumber));
      }

      const files = await getSubjectFiles(subject.id);
      
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
사용자가 제공한 학습 자료(해당 갤러리에 배정된 핵심 페이지)와 선택한 갤러리(대주제)를 바탕으로 개념글(소주제) 목차를 생성해주세요.

선택한 갤러리:
[${gallery.galleryId}] ${gallery.title} - ${gallery.description}

${getPersonaPrompt(subject.personaMode, subject.customPersona)}

[대원칙]
이 커리큘럼은 단순 정보 전달이 아닌 [구조 인식 ➔ 인과 연결 ➔ 지식 통합 ➔ 창의적 적용]의 4단계를 거쳐 사용자를 '준전문가' 및 '기출 학살자'로 양성하기 위한 인지적 스캐폴딩(지식의 계단)입니다.

지시사항:
1. 첨부된 페이지 이미지와 텍스트를 꼼꼼히 분석하여 개념글(소주제) 목차를 구성하세요. 이전 내용이 다음 내용의 완벽한 발판이 되도록 빌드업을 탄탄히 설계하세요.
2. 각 개념글은 서로 내용이 겹치지 않아야 하며(중복 최소화), 주어진 자료 내의 모든 핵심 정보가 누락 없이 포함되도록 구성하세요.
3. 내용의 논리적 완결성과 깊이를 고려하여 구성하세요. 기출문제가 없는 파트도 논리적 완결성을 위해 반드시 생성하세요.
4. 개념글의 'description'은 학습자의 지적 호기심을 자극하면서도 정중하고 명확한 어투(예: "많은 학생들이 헷갈리는 핵심 개념", "기출문제에서 자주 묻는 출제 포인트")로 작성하세요.
5. 마지막 개념글은 항상 해당 갤러리 범위 전체에 대해 주관식(대화형)으로 20문제를 퀴즈로 출제하는 항목이어야 합니다.
6. JSON 배열 형식으로 응답해주세요.
`;

      const contents: any[] = [{ text: promptText }];
      
      if (targetPages.length > 0) {
        contents.push({ text: "--- 갤러리 관련 핵심 참고 자료 (PDF 페이지) ---" });
        for (const p of targetPages) {
          const category = p.fileId ? fileCategoryMap[p.fileId] || '기타 자료' : '기타 자료';
          contents.push({ text: `[${category} - Page ${p.pageNumber} Text]:\n${p.text}` });
          if (p.imageBase64) {
            const base64Data = p.imageBase64.split(',')[1];
            if (base64Data) {
              contents.push({
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data
                }
              });
            }
          }
        }
      } else if (files.length === 0) {
        contents.push({ text: `학습 자료:\n${subject.materialsText || ''}` });
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
                id: { type: Type.STRING, description: '개념글 ID (예: G01-P01)' },
                title: { type: Type.STRING, description: '개념글 제목' },
                description: { type: Type.STRING, description: '명확하고 흥미로운 설명' },
                isQuiz: { type: Type.BOOLEAN, description: '마지막 퀴즈 항목인지 여부' },
              },
              required: ['id', 'title', 'description', 'isQuiz'],
            },
          },
        },
      });

      const text = response.text;
      if (text) {
        const parsedPosts = JSON.parse(text) as any[];
        const newPosts: ConceptPost[] = parsedPosts.map(p => ({
          id: crypto.randomUUID(),
          galleryId: gallery.id,
          postId: p.id,
          title: p.title,
          description: p.description,
          isQuiz: p.isQuiz,
          createdAt: Date.now(),
        }));
        
        await savePosts(newPosts);
        await loadData();
      } else {
        throw new Error('응답이 비어있습니다.');
      }
    } catch (err: any) {
      setError(err.message || '개념글 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!gallery) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8 max-w-3xl mx-auto"
    >
      <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm space-y-4 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 text-sm font-bold px-3 py-1 rounded-lg transition-colors duration-200">
            {gallery.galleryId}
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 transition-colors duration-200">{gallery.title}</h2>
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 text-lg transition-colors duration-200">{gallery.description}</p>
        {gallery.pastExams && (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-800/50 p-3 rounded-lg border border-neutral-100 dark:border-neutral-700/50 transition-colors duration-200">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300 mr-2">관련 기출:</span>
            {gallery.pastExams}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-xl flex items-center gap-2 text-neutral-900 dark:text-neutral-100 transition-colors duration-200">
            개념글 커리큘럼
            <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-full transition-colors duration-200">
              {posts.length}개
            </span>
          </h3>
          
          {posts.length === 0 && (
            <button
              onClick={handleGeneratePosts}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {generationStatus || '개념글 생성 중...'}
                </>
              ) : (
                <>
                  <PlayCircle size={18} />
                  개념글 생성하기
                </>
              )}
            </button>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium transition-colors duration-200">
            {error}
          </div>
        )}

        {posts.length === 0 && !loading && (
          <div className="py-16 flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl text-neutral-500 dark:text-neutral-400 text-center bg-white dark:bg-neutral-900 transition-colors duration-200">
            <BookOpen size={48} className="mb-4 text-neutral-300 dark:text-neutral-600 transition-colors duration-200" />
            <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2 transition-colors duration-200">아직 생성된 개념글이 없습니다.</p>
            <p className="text-sm">우측 상단의 버튼을 눌러 개념글 커리큘럼을 생성해보세요.</p>
          </div>
        )}

        {loading && posts.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center space-y-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 transition-colors duration-200">
            <Loader2 size={40} className="animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-neutral-500 dark:text-neutral-400 font-medium transition-colors duration-200">{generationStatus || '자료를 분석하여 개념글을 생성하고 있습니다...'}</p>
          </div>
        )}

        {posts.length > 0 && (
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden transition-colors duration-200">
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 transition-colors duration-200">
              {posts.map((post, index) => (
                <div
                  key={post.id}
                  className={`p-6 flex items-start gap-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors ${
                    post.isQuiz ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                  }`}
                >
                  <div className="flex-shrink-0 mt-1">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors duration-200 ${
                      post.isQuiz ? 'bg-blue-600 dark:bg-blue-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                    }`}>
                      {index + 1}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-400 dark:text-neutral-500 transition-colors duration-200">{post.postId}</span>
                      <h4 className={`font-bold text-base transition-colors duration-200 ${post.isQuiz ? 'text-blue-900 dark:text-blue-300' : 'text-neutral-900 dark:text-neutral-100'}`}>
                        {post.title}
                      </h4>
                    </div>
                    <p className={`text-sm transition-colors duration-200 ${post.isQuiz ? 'text-blue-700/80 dark:text-blue-400/80' : 'text-neutral-600 dark:text-neutral-400'}`}>
                      {post.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
