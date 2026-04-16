import { GoogleGenAI, Type } from '@google/genai';
import { 
  SubjectPage, 
  SubjectSegment, 
  LocalCluster, 
  saveLocalClusters, 
  GlobalGallery, 
  saveGlobalGalleries,
  SubjectFile
} from './db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function clusterFileLocally(
  fileId: string,
  pages: SubjectPage[],
  segments: SubjectSegment[],
  questions: any[] = []
): Promise<LocalCluster[]> {
  
  const units = [
    ...pages.map(p => ({ type: 'PAGE' as const, id: p.id, text: p.text })),
    ...segments.map(s => ({ type: 'SEGMENT' as const, id: s.id, text: s.text })),
    ...questions.map(q => ({ type: 'QID' as const, id: q.id, text: q.questionText }))
  ];

  const prompt = `이 파일의 학습 단위들을 분석하여 주제별로 군집화(Clustering)하라.
규칙:
1. 유사한 주제를 가진 학습 단위들을 묶어 LocalCluster를 생성하라.
2. 각 클러스터는 topic(주제명), summary(요약), units(해당 단위들의 type과 id 배열)을 가져야 한다.
3. 모든 학습 단위는 반드시 하나 이상의 클러스터에 포함되어야 한다.
4. 출력 형식: LocalCluster 배열을 JSON으로 반환하라.

학습 단위들:
${JSON.stringify(units.map(u => ({ type: u.type, id: u.id, text: u.text.substring(0, 500) })))}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING },
            summary: { type: Type.STRING },
            units: {
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
          required: ['topic', 'summary', 'units']
        }
      }
    }
  });

  if (!response.text) throw new Error("AI 군집화 실패");
  
  const clusters: LocalCluster[] = JSON.parse(response.text).map((c: any) => ({
    ...c,
    id: crypto.randomUUID(),
    fileId
  }));
  
  await saveLocalClusters(clusters);
  return clusters;
}

export async function integrateClustersGlobally(
  subjectId: string,
  files: SubjectFile[],
  allClusters: LocalCluster[]
): Promise<GlobalGallery[]> {
  // 1. [AI 기반 갤러리 뼈대 생성]
  const prompt = `Core 자료(LECTURE)를 분석하여 전체 시험 범위를 정의하는 '마스터 갤러리 구조(뼈대)'를 생성하라.
Core 자료: ${JSON.stringify(allClusters.filter(c => files.find(f => f.id === c.fileId)?.category === 'LECTURE').map(c => ({ id: c.id, topic: c.topic, summary: c.summary })))}
규칙:
1. relevantUnits는 반드시 빈 배열([])로 생성하라.
2. 각 갤러리에 description(갤러리 설명)과 scopeDescription(범위 정의 및 핵심 키워드)을 매우 상세하게 작성하라.
출력 형식: GlobalGallery 배열을 JSON으로 반환하라.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  if (!response.text) throw new Error("뼈대 생성 실패");
  const galleries: GlobalGallery[] = JSON.parse(response.text);

  // 2. [시스템 기반 통합 매핑]
  // 실제 구현에서는 여기에 벡터 DB 유사도 검색 로직이 들어갑니다.
  // 여기서는 구조를 잡고, 매핑 로직을 호출하는 형태로 구현합니다.
  const finalGalleries = await performSystemMapping(galleries, allClusters);

  await saveGlobalGalleries(finalGalleries);
  return finalGalleries;
}

// 코사인 유사도 계산 함수
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 평균 벡터 계산 함수
function calculateAverageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i] / vectors.length;
    }
  }
  return avg;
}

// 시스템 기반 매핑 함수
async function performSystemMapping(galleries: GlobalGallery[], allClusters: LocalCluster[], allPages: SubjectPage[], allSegments: SubjectSegment[]): Promise<GlobalGallery[]> {
  // ID별 임베딩 맵 생성
  const embeddingMap = new Map<string, number[]>();
  allPages.forEach(p => embeddingMap.set(p.id, p.embedding));
  allSegments.forEach(s => embeddingMap.set(s.id, s.embedding));

  // 모든 학습 단위 평탄화
  const allUnits = allClusters.flatMap(c => c.units);

  return galleries.map(gallery => {
    // 갤러리 벡터 계산 (relevantUnits의 평균 벡터)
    const unitIds = gallery.relevantUnits.map(u => u.id);
    const unitEmbeddings = unitIds.map(id => embeddingMap.get(id)).filter(Boolean) as number[][];
    
    // 갤러리 벡터가 없으면(초기 상태) 뼈대 생성 시 AI가 준 정보를 기반으로 해야 하지만,
    // 여기서는 일단 유닛이 있을 때만 계산.
    if (unitEmbeddings.length === 0) return gallery;
    
    const galleryVector = calculateAverageVector(unitEmbeddings);

    // 모든 학습 단위와 유사도 계산 및 필터링 (임계값 0.75)
    const relevantUnits = allUnits.filter(unit => {
      const unitVector = embeddingMap.get(unit.id);
      if (!unitVector) return false;
      return cosineSimilarity(galleryVector, unitVector) >= 0.75;
    });

    return {
      ...gallery,
      relevantUnits
    };
  });
}
