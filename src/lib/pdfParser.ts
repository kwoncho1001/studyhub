import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ProcessedPage {
  pageNumber: number;
  text: string;
  imageBase64: string;
}

export async function processPDFPages(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<ProcessedPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: ProcessedPage[] = [];

  const CHUNK_SIZE = 5; // 메모리 과부하 방지를 위해 5페이지씩 병렬 처리
  let processedCount = 0;

  for (let i = 1; i <= pdf.numPages; i += CHUNK_SIZE) {
    const chunkPromises = [];
    const end = Math.min(i + CHUNK_SIZE - 1, pdf.numPages);

    for (let j = i; j <= end; j++) {
      chunkPromises.push((async () => {
        const page = await pdf.getPage(j);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(' ');

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        let imageBase64 = '';
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          // @ts-ignore
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        }

        return { pageNumber: j, text, imageBase64 };
      })());
    }

    const chunkResults = await Promise.all(chunkPromises);
    
    // 페이지 순서 보장
    chunkResults.sort((a, b) => a.pageNumber - b.pageNumber);
    pages.push(...chunkResults);

    processedCount += chunkResults.length;
    if (onProgress) {
      onProgress(processedCount, pdf.numPages);
    }
  }

  return pages;
}

export async function extractTextFromTXT(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}
