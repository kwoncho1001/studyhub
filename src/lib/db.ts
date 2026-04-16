import { get, set, del, update } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';

export interface Subject {
  id: string;
  name: string;
  createdAt: number;
  materialsText: string;
  mode: 1 | 2;
  personaMode?: 'standard' | 'easy' | 'meme' | 'custom';
  customPersona?: string;
}

export interface Gallery {
  id: string;
  subjectId: string;
  galleryId: string; // e.g., G01
  title: string;
  description: string;
  pastExams: string;
  mappedExamIds?: string[]; // Array of parsed question IDs
  relevantPages?: number[];
  relevantUnits?: StudyUnit[];
  createdAt: number;
}

export interface QuizItem {
  id: string;
  question: string;
  userAnswer?: string;
  isCorrect?: boolean;
  feedback?: string;
}

export interface ConceptPost {
  id: string;
  galleryId: string; // references Gallery.id (the uuid)
  postId: string; // e.g., G01-P01
  title: string;
  description: string;
  isQuiz: boolean;
  content?: string; // Markdown content for the post
  quizData?: QuizItem[]; // Quiz data if isQuiz is true
  createdAt: number;
}

export interface PostQnA {
  id: string;
  postId: string;
  question: string;
  answer: string;
  createdAt: number;
}

export type FileCategory = 'LECTURE' | 'RECORDING' | 'EXAM';

export interface ExamQuestion {
  id: string; // e.g., "2023-1중간-Q01"
  questionText: string;
}

export interface SubjectFile {
  id: string;
  subjectId: string;
  name: string;
  content: string;
  category: FileCategory;
  createdAt: number;
  examYear?: string;
  examTerm?: string;
  examType?: string;
  examGrade?: string;
  parsedQuestions?: ExamQuestion[];
}

export interface SubjectPage {
  id: string; // uuid
  subjectId: string;
  fileId?: string;
  pageNumber: number;
  text: string;
  imageBase64?: string;
  embedding: number[];
}

export interface SubjectSegment {
  id: string; // uuid
  subjectId: string;
  fileId: string;
  segmentIndex: number;
  text: string;
  embedding: number[];
}

export interface LocalCluster {
  id: string;
  fileId: string;
  topic: string;
  summary: string;
  units: { type: 'PAGE' | 'SEGMENT' | 'QID', id: string }[];
}

export interface StudyUnit {
  type: 'PAGE' | 'SEGMENT' | 'QID';
  id: string;
}

export interface GlobalGallery {
  id: string;
  subjectId: string;
  title: string;
  description: string;
  relevantUnits: StudyUnit[];
  createdAt: number;
}

// Keys
const SUBJECTS_KEY = 'dc-study-hub-subjects';
const GALLERIES_KEY = 'dc-study-hub-galleries';
const POSTS_KEY = 'dc-study-hub-posts';
const PAGES_KEY = 'dc-study-hub-pages';
const SEGMENTS_KEY = 'dc-study-hub-segments';
const LOCAL_CLUSTERS_KEY = 'dc-study-hub-local-clusters';
const GLOBAL_GALLERIES_KEY = 'dc-study-hub-global-galleries';
const FILES_KEY = 'dc-study-hub-files';

// Subjects
export async function getSubjects(): Promise<Subject[]> {
  return (await get<Subject[]>(SUBJECTS_KEY)) || [];
}

export async function getSubject(id: string): Promise<Subject | undefined> {
  const subjects = await getSubjects();
  return subjects.find((s) => s.id === id);
}

export async function createSubject(name: string): Promise<Subject> {
  const newSubject: Subject = {
    id: uuidv4(),
    name,
    createdAt: Date.now(),
    materialsText: '',
    mode: 1,
    personaMode: 'easy',
  };
  await update(SUBJECTS_KEY, (val) => [...(val || []), newSubject]);
  return newSubject;
}

export async function updateSubject(id: string, updates: Partial<Subject>): Promise<void> {
  await update(SUBJECTS_KEY, (val) => {
    const subjects = val || [];
    return subjects.map((s) => (s.id === id ? { ...s, ...updates } : s));
  });
}

export async function deleteSubject(id: string): Promise<void> {
  await update(SUBJECTS_KEY, (val) => (val || []).filter((s) => s.id !== id));
  // Cascade delete galleries, posts, and pages
  const galleries = await getGalleriesBySubject(id);
  const galleryIds = galleries.map((g) => g.id);
  
  await update(GALLERIES_KEY, (val) => (val || []).filter((g) => g.subjectId !== id));
  await update(POSTS_KEY, (val) => (val || []).filter((p) => !galleryIds.includes(p.galleryId)));
  await update(PAGES_KEY, (val) => (val || []).filter((p) => p.subjectId !== id));
  await update(FILES_KEY, (val) => (val || []).filter((f) => f.subjectId !== id));
}

export async function deleteSubjectCurriculum(subjectId: string): Promise<void> {
  const galleries = await getGalleriesBySubject(subjectId);
  const galleryIds = galleries.map((g) => g.id);
  
  await update(GALLERIES_KEY, (val) => (val || []).filter((g) => g.subjectId !== subjectId));
  await update(POSTS_KEY, (val) => (val || []).filter((p) => !galleryIds.includes(p.galleryId)));
}

// Files
export async function getSubjectFiles(subjectId: string): Promise<SubjectFile[]> {
  const files = (await get<SubjectFile[]>(FILES_KEY)) || [];
  return files.filter((f) => f.subjectId === subjectId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveSubjectFile(file: SubjectFile): Promise<void> {
  await update(FILES_KEY, (val) => [...(val || []), file]);
}

export async function updateSubjectFile(id: string, updates: Partial<SubjectFile>): Promise<void> {
  await update(FILES_KEY, (val) => {
    const files = val || [];
    return files.map((f) => (f.id === id ? { ...f, ...updates } : f));
  });
}

export async function deleteSubjectFile(id: string): Promise<void> {
  await update(FILES_KEY, (val) => (val || []).filter((f) => f.id !== id));
  // Cascade delete pages associated with this file
  await update(PAGES_KEY, (val) => (val || []).filter((p) => p.fileId !== id));
}

// Galleries
export async function getGalleriesBySubject(subjectId: string): Promise<Gallery[]> {
  const galleries = (await get<Gallery[]>(GALLERIES_KEY)) || [];
  return galleries.filter((g) => g.subjectId === subjectId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getGallery(id: string): Promise<Gallery | undefined> {
  const galleries = (await get<Gallery[]>(GALLERIES_KEY)) || [];
  return galleries.find((g) => g.id === id);
}

export async function saveGalleries(galleries: Gallery[]): Promise<void> {
  await update(GALLERIES_KEY, (val) => [...(val || []), ...galleries]);
}

// Concept Posts
export async function getPostsByGallery(galleryId: string): Promise<ConceptPost[]> {
  const posts = (await get<ConceptPost[]>(POSTS_KEY)) || [];
  return posts.filter((p) => p.galleryId === galleryId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function savePosts(posts: ConceptPost[]): Promise<void> {
  await update(POSTS_KEY, (val) => [...(val || []), ...posts]);
}

export async function updatePost(id: string, updates: Partial<ConceptPost>): Promise<void> {
  await update(POSTS_KEY, (val) => {
    const posts = val || [];
    return posts.map((p) => (p.id === id ? { ...p, ...updates } : p));
  });
}

const QNA_KEY = 'dc-study-hub-qna';

export async function getQnAsByPost(postId: string): Promise<PostQnA[]> {
  const qnas = (await get<PostQnA[]>(QNA_KEY)) || [];
  return qnas.filter((q) => q.postId === postId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveQnA(qna: PostQnA): Promise<void> {
  await update(QNA_KEY, (val) => [...(val || []), qna]);
}

export async function deleteQnA(id: string): Promise<void> {
  await update(QNA_KEY, (val) => (val || []).filter((q) => q.id !== id));
}

// Export / Import
export async function exportSubjectData(subjectId: string): Promise<string> {
  const subject = await getSubject(subjectId);
  if (!subject) throw new Error('Subject not found');

  const files = await getSubjectFiles(subjectId);
  const rawPages = await getSubjectPages(subjectId);
  // 임베딩 정밀도 낮추기 및 imageBase64 제거 (기존 데이터 내보낼 때 용량 최적화)
  const pages = rawPages.map(p => {
    const { imageBase64, ...rest } = p;
    return {
      ...rest,
      embedding: p.embedding.map(v => Number(v.toFixed(4)))
    };
  });
  const galleries = await getGalleriesBySubject(subjectId);
  
  const posts: ConceptPost[] = [];
  for (const g of galleries) {
    const gPosts = await getPostsByGallery(g.id);
    posts.push(...gPosts);
  }

  const qnas: PostQnA[] = [];
  for (const p of posts) {
    const pQnas = await getQnAsByPost(p.id);
    qnas.push(...pQnas);
  }

  const exportData = {
    version: '1.0',
    subject,
    files,
    pages,
    galleries,
    posts,
    qnas
  };

  return JSON.stringify(exportData);
}

export async function importSubjectData(jsonString: string): Promise<Subject> {
  const data = JSON.parse(jsonString);
  if (!data.subject || !data.version) throw new Error('Invalid backup file');

  // To avoid ID collisions and allow multiple imports of the same file, 
  // we generate a new subject ID but keep the internal structure.
  // Actually, for a simple backup/restore, we can just save them.
  // But let's make it a "New Subject" import for safety.
  
  const oldSubjectId = data.subject.id;
  const newSubjectId = uuidv4();
  
  const newSubject: Subject = {
    ...data.subject,
    id: newSubjectId,
    createdAt: Date.now()
  };

  // Map old IDs to new IDs to maintain relationships
  const fileIdMap: Record<string, string> = {};
  const galleryIdMap: Record<string, string> = {};
  const postIdMap: Record<string, string> = {};

  const newFiles: SubjectFile[] = (data.files || []).map((f: SubjectFile) => {
    const newId = uuidv4();
    fileIdMap[f.id] = newId;
    return { ...f, id: newId, subjectId: newSubjectId };
  });

  const newPages: SubjectPage[] = (data.pages || []).map((p: SubjectPage) => ({
    ...p,
    id: uuidv4(),
    subjectId: newSubjectId,
    fileId: p.fileId ? fileIdMap[p.fileId] : undefined
  }));

  const newGalleries: Gallery[] = (data.galleries || []).map((g: Gallery) => {
    const newId = uuidv4();
    galleryIdMap[g.id] = newId;
    return { ...g, id: newId, subjectId: newSubjectId };
  });

  const newPosts: ConceptPost[] = (data.posts || []).map((p: ConceptPost) => {
    const newId = uuidv4();
    postIdMap[p.id] = newId;
    return { ...p, id: newId, galleryId: galleryIdMap[p.galleryId] };
  });

  const newQnas: PostQnA[] = (data.qnas || []).map((q: PostQnA) => ({
    ...q,
    id: uuidv4(),
    postId: postIdMap[q.postId]
  }));

  // Save everything
  await update(SUBJECTS_KEY, (val) => [...(val || []), newSubject]);
  await update(FILES_KEY, (val) => [...(val || []), ...newFiles]);
  await update(PAGES_KEY, (val) => [...(val || []), ...newPages]);
  await update(GALLERIES_KEY, (val) => [...(val || []), ...newGalleries]);
  await update(POSTS_KEY, (val) => [...(val || []), ...newPosts]);
  await update(QNA_KEY, (val) => [...(val || []), ...newQnas]);

  return newSubject;
}

// Pages (RAG) - Updated to handle individual pages
export async function saveSubjectPages(pages: SubjectPage[]): Promise<void> {
  await update(PAGES_KEY, (val) => [...(val || []), ...pages]);
}

export async function getSubjectPages(subjectId: string): Promise<SubjectPage[]> {
  const pages = (await get<SubjectPage[]>(PAGES_KEY)) || [];
  return pages.filter((p) => p.subjectId === subjectId).sort((a, b) => a.pageNumber - b.pageNumber);
}

// Segments (RAG for TXT)
export async function saveSubjectSegments(segments: SubjectSegment[]): Promise<void> {
  await update(SEGMENTS_KEY, (val) => [...(val || []), ...segments]);
}

export async function getSubjectSegments(fileId: string): Promise<SubjectSegment[]> {
  const segments = (await get<SubjectSegment[]>(SEGMENTS_KEY)) || [];
  return segments.filter((s) => s.fileId === fileId).sort((a, b) => a.segmentIndex - b.segmentIndex);
}

// Local Clusters
export async function saveLocalClusters(clusters: LocalCluster[]): Promise<void> {
  await update(LOCAL_CLUSTERS_KEY, (val) => [...(val || []), ...clusters]);
}

export async function getLocalClusters(fileId: string): Promise<LocalCluster[]> {
  const clusters = (await get<LocalCluster[]>(LOCAL_CLUSTERS_KEY)) || [];
  return clusters.filter((c) => c.fileId === fileId);
}

// Global Galleries
export async function saveGlobalGalleries(galleries: GlobalGallery[]): Promise<void> {
  await update(GLOBAL_GALLERIES_KEY, (val) => [...(val || []), ...galleries]);
}

export async function getGlobalGalleries(subjectId: string): Promise<GlobalGallery[]> {
  const galleries = (await get<GlobalGallery[]>(GLOBAL_GALLERIES_KEY)) || [];
  return galleries.filter((g) => g.subjectId === subjectId);
}
