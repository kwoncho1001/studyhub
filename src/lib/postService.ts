import { Gallery, ConceptPost, StudyUnit, SubjectPage, SubjectSegment, savePosts, getSubjectPages, getSubjectSegments, getSubject } from './db';
import { GoogleGenAI } from '@google/genai';
import { getPersonaPrompt } from './persona';
import { cosineSimilarity } from './clustering';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const is503 = error?.error?.code === 503 || error?.status === 503;
    if (retries > 0 && is503) {
      console.warn(`Retrying AI call due to 503 error. Retries left: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function generateConceptPostOutline(gallery: Gallery, subjectId: string): Promise<any[]> {
  const s = await getSubject(subjectId);
  const personaMode = s?.personaMode;
  const customPersona = s?.customPersona;

  const prompt = `당신은 대학 전공 과목의 개념글을 작성하는 전문가입니다.
선택한 갤러리: [${gallery.galleryId}] ${gallery.title} - ${gallery.description}
이 갤러리의 학습 목표를 달성하기 위한 개념글(소주제) 목차를 생성하라.

[페르소나 설정]
${getPersonaPrompt(personaMode, customPersona)}

지시사항:
1. JSON 배열 형식으로 응답하세요.
2. 각 항목은 { heading: string, description: string, requiredConcepts: string[] } 구조여야 합니다.

JSON 형식:
[
  {
    "heading": "개념글 제목",
    "description": "개념글 설명",
    "requiredConcepts": ["핵심키워드1", "핵심키워드2"]
  }
]`;

  const response = await withRetry(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  }));
  if (!response.text) {
    console.error("AI response is empty for prompt:", prompt);
    throw new Error("목차 생성 실패: AI 응답이 비어있습니다.");
  }
  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse AI response as JSON:", response.text);
    throw new Error("목차 생성 실패: JSON 파싱 오류");
  }
}

export async function generateConceptPostContent(section: any, mappedUnits: StudyUnit[], allPages: SubjectPage[], allSegments: SubjectSegment[]): Promise<string> {
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

  const res = await withRetry(() => ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
  }));
  return res.text || "내용 생성 실패";
}

export async function mapContentToOutline(outline: any[], relevantUnits: StudyUnit[], allPages: SubjectPage[], allSegments: SubjectSegment[]): Promise<ConceptPost[]> {
  const textMap = new Map<string, string>();
  allPages.forEach(p => textMap.set(`${p.fileId}:${p.pageNumber}`, p.text));
  allSegments.forEach(s => textMap.set(s.id, s.text));

  return Promise.all(outline.map(async (section: any, index: number) => {
    const heading = section.heading || '제목 없음';
    const description = section.description || '';
    const concepts = Array.isArray(section.requiredConcepts) ? section.requiredConcepts : [];
    const sectionText = `${heading} ${description} ${concepts.join(' ')}`.toLowerCase();
    
    const mappedUnits = relevantUnits.filter(unit => {
      const unitId = unit.type === 'PAGE' ? unit.id : unit.id;
      const unitText = textMap.get(unitId)?.toLowerCase() || '';
      if (!unitText) return false;
      
      const score = calculateSimilarity(sectionText, unitText);
      return score >= 0.05;
    });

    const content = await generateConceptPostContent(section, mappedUnits, allPages, allSegments);

    return {
      id: crypto.randomUUID(),
      galleryId: '',
      postId: '',
      title: section.heading,
      description: section.description,
      isQuiz: false,
      content: content,
      mappedMaterials: mappedUnits,
      createdAt: Date.now(),
    };
  }));
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(' '));
  const words2 = new Set(text2.split(' '));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  return intersection.size / Math.max(words1.size, words2.size);
}

export async function generatePostsForGallery(gallery: Gallery, subjectId: string): Promise<ConceptPost[]> {
  const outline = await generateConceptPostOutline(gallery, subjectId);
  const allPages = await getSubjectPages(subjectId);
  const allSegments = await getSubjectSegments(subjectId);
  const posts = await mapContentToOutline(outline, gallery.relevantUnits || [], allPages, allSegments);
  
  const finalPosts = posts.map((p, index) => ({
    ...p,
    galleryId: gallery.id,
    postId: `${gallery.galleryId}-P${String(index + 1).padStart(2, '0')}`
  }));

  await savePosts(finalPosts);
  return finalPosts;
}
