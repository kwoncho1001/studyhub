import { GoogleGenAI, Type } from '@google/genai';
import { SubjectSegment } from './db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function processTXTFile(
  file: File,
  subjectId: string,
  fileId: string,
  onProgress: (progress: string) => void
): Promise<SubjectSegment[]> {
  const text = await file.text();
  
  // Heuristic pre-processing: Remove common filler words and excessive whitespace
  const preProcessedText = text
    .replace(/\b(음|어|그|저|뭐|막|이제|요런|요런식으로|이런식으로)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const CHUNK_SIZE = 4000; // Characters per chunk
  const chunks: string[] = [];
  
  for (let i = 0; i < preProcessedText.length; i += CHUNK_SIZE) {
    chunks.push(preProcessedText.substring(i, i + CHUNK_SIZE));
  }
  
  onProgress(`AI 후처리 중... (총 ${chunks.length}개 청크)`);
  
  const processedSegments: SubjectSegment[] = [];
  let processedCount = 0;
  
  const chunkResults = await Promise.all(
    chunks.map(async (chunk, index) => {
      const prompt = `이 텍스트는 수업 녹음본 스크립트의 일부이다. 다음 규칙에 따라 원본 내용을 완벽하게 보존하며 정제하라:
1. 직접 수정(Direct Edit) 모드: 원본 텍스트의 모든 상세 설명, 예시, 수치 데이터는 하나도 빠짐없이 그대로 유지하라. 내용을 요약하거나 다시 쓰지 마라.
2. 노이즈 제거: 의미 없는 반복어구만 제거하고 문장을 매끄럽게 연결하라.
3. 단락 구분: 의미적 주제 전환을 기준으로 단락을 나누어라.
4. 출력 형식: 정제된 텍스트 단락들을 담은 JSON 배열만 반환하라. 서론, 결론, 부연 설명은 절대 포함하지 마라.

텍스트:
${chunk}
`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
      });

      if (!response.text) throw new Error(`AI 후처리 실패 (청크 ${index + 1})`);
      
      const segments: string[] = JSON.parse(response.text);
      
      processedCount++;
      onProgress(`AI 후처리 중... (${processedCount}/${chunks.length})`);
      
      return segments;
    })
  );
  
  for (const segments of chunkResults) {
    for (const segmentText of segments) {
      processedSegments.push({
        id: crypto.randomUUID(),
        subjectId,
        fileId,
        segmentIndex: processedSegments.length,
        text: segmentText,
        embedding: [], // Embedding will be generated in a separate pass or optimized
      });
    }
  }
  
  onProgress("임베딩 생성 중...");
  
  // Generate embeddings for all segments
  for (let i = 0; i < processedSegments.length; i++) {
    try {
      const embedRes = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: processedSegments[i].text,
      });
      processedSegments[i].embedding = (embedRes.embeddings?.[0]?.values || []).map(
        (v) => Number(v.toFixed(4)),
      );
    } catch (e) {
      console.error("Embedding failed for segment", i, e);
    }
  }
  
  return processedSegments;
}
