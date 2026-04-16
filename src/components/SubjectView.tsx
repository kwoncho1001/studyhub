import React, { useState, useEffect, useRef } from "react";
import {
  Subject,
  SubjectFile,
  FileCategory,
  getSubject,
  updateSubject,
  saveSubjectPages,
  getSubjectFiles,
  saveSubjectFile,
  updateSubjectFile,
  deleteSubjectFile,
  exportSubjectData,
} from "../lib/db";
import { useUpload } from "../contexts/UploadContext";
import { GoogleGenAI, Type } from "@google/genai";
import { motion } from "motion/react";
import {
  FileText,
  Upload,
  Loader2,
  PlayCircle,
  CheckCircle2,
  Trash2,
  BookOpen,
  X,
  Download,
  Mic,
  PenTool,
} from "lucide-react";
import { MaterialInterpretationSelector } from "./MaterialInterpretationSelector";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface SubjectViewProps {
  subjectId: string;
}

export function SubjectView({ subjectId }: SubjectViewProps) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [subjectFiles, setSubjectFiles] = useState<SubjectFile[]>([]);
  const [viewingFile, setViewingFile] = useState<SubjectFile | null>(null);
  const [personaMode, setPersonaMode] = useState<
    "standard" | "easy" | "meme" | "custom"
  >("easy");
  const [customPersona, setCustomPersona] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles, lastCompletedAt } = useUpload();

  // Exam Parsing Modal State
  const [parsingExamFile, setParsingExamFile] = useState<SubjectFile | null>(
    null,
  );
  const [examYear, setExamYear] = useState("");
  const [examTerm, setExamTerm] = useState("");
  const [examType, setExamType] = useState("");
  const [examGrade, setExamGrade] = useState("");
  const [parsedQuestions, setParsedQuestions] = useState<any[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const [uploadCategory, setUploadCategory] = useState<FileCategory>("LECTURE");

  useEffect(() => {
    loadData();
  }, [subjectId, lastCompletedAt]);

  const loadData = async () => {
    const s = await getSubject(subjectId);
    if (s) {
      setSubject(s);
      if (s.personaMode) setPersonaMode(s.personaMode);
      if (s.customPersona) setCustomPersona(s.customPersona);
    }
    const f = await getSubjectFiles(subjectId);
    setSubjectFiles(f);
  };

  const handlePersonaModeChange = async (
    newPersonaMode: "standard" | "easy" | "meme" | "custom",
  ) => {
    setPersonaMode(newPersonaMode);
    await updateSubject(subjectId, { personaMode: newPersonaMode });
  };

  const handleCustomPersonaChange = async (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const val = e.target.value;
    setCustomPersona(val);
    await updateSubject(subjectId, { customPersona: val });
  };

  const handleCategoryChange = async (
    fileId: string,
    category: FileCategory,
  ) => {
    await updateSubjectFile(fileId, { category });
    await loadData();
  };

  const handleDeleteFile = (fileId: string) => {
    setFileToDelete(fileId);
  };

  const confirmDeleteFile = async () => {
    if (fileToDelete) {
      await deleteSubjectFile(fileToDelete);
      await loadData();
      setFileToDelete(null);
    }
  };

  const triggerUpload = (category: FileCategory) => {
    setUploadCategory(category);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      await uploadFiles(subjectId, files, uploadCategory);
    } catch (err: any) {
      setError(err.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    try {
      const jsonString = await exportSubjectData(subjectId);
      const blob = new Blob([jsonString], { type: "application/json" });

      // GZIP 압축 적용 (CompressionStream API)
      const compressedStream = blob
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      const compressedBlob = await new Response(compressedStream).blob();

      const url = URL.createObjectURL(compressedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${subject?.name || "subject"}_backup_${new Date().toISOString().split("T")[0]}.json.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setAlertMessage("내보내기 중 오류가 발생했습니다.");
    }
  };

  const handleParseExam = async () => {
    if (!parsingExamFile) return;
    if (!examYear || !examTerm || !examType) {
      setAlertMessage("연도, 학기, 시험종류는 필수 입력 항목입니다.");
      return;
    }

    setIsParsing(true);
    try {
      const prompt = `다음 기출문제 텍스트에서 개별 문항을 분리하여 JSON 배열로 반환해.
메타데이터: ${examYear}년 ${examTerm} ${examType} (학년: ${examGrade})
각 문항의 id는 "[${examYear}-${examTerm}-${examType}-Q번호]" 형식으로 만들어 (예: [2023-1학기-중간-Q01]).
questionText에는 문제의 전체 내용(보기 포함)을 그대로 담아줘.

텍스트:
${parsingExamFile.content.substring(0, 30000)} // 텍스트가 너무 길면 잘릴 수 있으나, 일단 앞부분 위주로 파싱
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
                id: { type: Type.STRING },
                questionText: { type: Type.STRING },
              },
              required: ["id", "questionText"],
            },
          },
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        setParsedQuestions(parsed);
      }
    } catch (e: any) {
      setAlertMessage("문항 분석 중 오류가 발생했습니다: " + e.message);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSaveParsedExam = async () => {
    if (!parsingExamFile || !parsedQuestions) return;

    await updateSubjectFile(parsingExamFile.id, {
      examYear,
      examTerm,
      examType,
      examGrade,
      parsedQuestions,
    });

    setParsingExamFile(null);
    setParsedQuestions(null);
    setExamYear("");
    setExamTerm("");
    setExamType("");
    setExamGrade("");
    await loadData();
  };

  if (!subject) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 transition-colors duration-200">
            {subject.name}
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 transition-colors duration-200">
            학습 자료를 업로드하고 갤러리(대주제) 커리큘럼을 생성하세요.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Download size={18} />
          과목 내보내기
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Materials */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden flex flex-col transition-colors duration-200">
            <div className="bg-neutral-50 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between transition-colors duration-200">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                <FileText size={16} />
                학습 자료 관리
              </div>
              <input
                type="file"
                accept=".txt,.pdf"
                multiple
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <div className="p-4 space-y-6">
              {[
                {
                  id: "LECTURE" as FileCategory,
                  title: "강의자료",
                  icon: BookOpen,
                  desc: "교재, PPT 등 뼈대가 되는 자료",
                },
                {
                  id: "RECORDING" as FileCategory,
                  title: "녹음본",
                  icon: Mic,
                  desc: "실제 수업 스크립트, 강조 포인트",
                },
                {
                  id: "EXAM" as FileCategory,
                  title: "기출문제",
                  icon: PenTool,
                  desc: "실전 감각 및 출제 포인트",
                },
              ].map((cat) => {
                const catFiles = subjectFiles.filter(
                  (f) => f.category === cat.id,
                );
                return (
                  <div key={cat.id} className="space-y-3">
                    <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-bold text-neutral-800 dark:text-neutral-200">
                          <cat.icon size={16} className="text-blue-500" />
                          {cat.title}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {cat.desc}
                        </div>
                      </div>
                      <button
                        onClick={() => triggerUpload(cat.id)}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-xs bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50"
                      >
                        <Upload size={14} />
                        추가
                      </button>
                    </div>

                    {catFiles.length === 0 ? (
                      <div className="text-xs text-neutral-400 dark:text-neutral-500 py-4 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded-lg bg-neutral-50/50 dark:bg-neutral-800/20">
                        업로드된 {cat.title}가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {catFiles.map((file) => (
                          <div
                            key={file.id}
                            className="flex flex-col gap-2 bg-neutral-50 dark:bg-neutral-800/50 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors duration-200"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 overflow-hidden">
                                <FileText
                                  size={16}
                                  className="text-neutral-400 flex-shrink-0"
                                />
                                <div className="truncate font-medium text-sm text-neutral-800 dark:text-neutral-200">
                                  {file.name}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => setViewingFile(file)}
                                  className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                  title="내용 보기"
                                >
                                  <BookOpen size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteFile(file.id)}
                                  className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  title="삭제"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                            {file.category === "EXAM" && (
                              <div className="flex items-center justify-between bg-white dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-700 mt-1">
                                <div className="text-xs text-neutral-600 dark:text-neutral-400">
                                  {file.parsedQuestions &&
                                  file.parsedQuestions.length > 0 ? (
                                    <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                                      <CheckCircle2 size={14} />
                                      {file.parsedQuestions.length}문항 분석
                                      완료 ({file.examYear} {file.examTerm}{" "}
                                      {file.examType})
                                    </span>
                                  ) : (
                                    <span className="text-orange-600 dark:text-orange-400 font-medium">
                                      기출문제 분석에 실패했습니다. 수동 분석이
                                      필요합니다.
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    setParsingExamFile(file);
                                    setExamYear(file.examYear || "");
                                    setExamTerm(file.examTerm || "");
                                    setExamType(file.examType || "");
                                    setExamGrade(file.examGrade || "");
                                    setParsedQuestions(
                                      file.parsedQuestions || null,
                                    );
                                  }}
                                  className="text-xs bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-2 py-1 rounded font-medium transition-colors"
                                >
                                  검토/수정
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Settings */}
        <div className="space-y-6 flex flex-col">
          <MaterialInterpretationSelector subjectId={subjectId} />

          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm p-5 space-y-4 transition-colors duration-200">
            <h3 className="font-semibold text-sm text-neutral-700 dark:text-neutral-300">
              AI 페르소나 설정
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  id: "standard",
                  title: "정석형 (Standard)",
                  desc: "교과서적 정의와 논리적 전개 집중 (비유 농도: Low)",
                },
                {
                  id: "easy",
                  title: "친절형 (Easy)",
                  desc: "보편적인 비유를 섞어 진입 장벽을 낮춤 (비유 농도: Medium)",
                },
                {
                  id: "meme",
                  title: "유머형 (Meme)",
                  desc: "재미있는 상황극과 드립으로 지루함 제거 (비유 농도: High)",
                },
                {
                  id: "custom",
                  title: "사용자 설정 (Custom)",
                  desc: "원하는 페르소나를 직접 텍스트로 입력",
                },
              ].map((p) => (
                <label
                  key={p.id}
                  className={`relative flex cursor-pointer rounded-lg border p-3 shadow-sm focus:outline-none transition-colors duration-200 ${
                    personaMode === p.id
                      ? "border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20"
                      : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="personaMode"
                    value={p.id}
                    checked={personaMode === p.id}
                    onChange={() => handlePersonaModeChange(p.id as any)}
                    className="sr-only"
                  />
                  <div className="flex w-full items-center justify-between">
                    <div className="text-sm">
                      <p
                        className={`font-medium ${personaMode === p.id ? "text-blue-900 dark:text-blue-300" : "text-neutral-900 dark:text-neutral-100"}`}
                      >
                        {p.title}
                      </p>
                      <p
                        className={`text-xs mt-0.5 ${personaMode === p.id ? "text-blue-700/70 dark:text-blue-400/70" : "text-neutral-500 dark:text-neutral-400"}`}
                      >
                        {p.desc}
                      </p>
                    </div>
                    {personaMode === p.id && (
                      <CheckCircle2 className="text-blue-600 dark:text-blue-400 h-4 w-4 shrink-0" />
                    )}
                  </div>
                </label>
              ))}

              {personaMode === "custom" && (
                <div className="mt-2">
                  <textarea
                    value={customPersona}
                    onChange={handleCustomPersonaChange}
                    placeholder="원하는 AI 페르소나를 자유롭게 입력하세요. (예: 츤데레 스타일로 팩폭하면서 가르쳐줘)"
                    className="w-full p-3 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-y min-h-[80px]"
                  />
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium transition-colors duration-200">
              {error}
            </div>
          )}
        </div>
      </div>

      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col transition-colors duration-200">
            <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 transition-colors duration-200">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <FileText size={20} className="text-blue-500" />
                {viewingFile.name}
              </h3>
              <button
                onClick={() => setViewingFile(null)}
                className="p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap custom-scrollbar">
              {viewingFile.category === 'LECTURE' && viewingFile.content.includes('--- Page') ? (
                <div className="space-y-6">
                  {viewingFile.content.split('--- Page').filter(Boolean).map((pageContent, index) => {
                    const [title, ...text] = pageContent.split('\n');
                    // title 예시: " 1 --- " -> "Page 1"
                    const pageNumber = title.replace(/[^0-9]/g, '');
                    return (
                      <div key={index} className="bg-neutral-50 dark:bg-neutral-800 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <h4 className="font-bold text-neutral-800 dark:text-neutral-200 mb-2">Page {pageNumber}</h4>
                        <p className="text-neutral-600 dark:text-neutral-400">{text.join('\n').trim()}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                viewingFile.content
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete File Confirmation Modal */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">
              파일 삭제
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm">
              이 파일을 삭제하시겠습니까?
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmDeleteFile}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">
              알림
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm">
              {alertMessage}
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setAlertMessage(null)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Exam Parsing Modal */}
      {parsingExamFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">
                기출문제 검토 및 수정
              </h3>
              <button
                onClick={() => {
                  setParsingExamFile(null);
                  setParsedQuestions(null);
                }}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
              <div className="space-y-4">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  AI가 자동으로 추출한 메타데이터와 문항입니다. 잘못된 부분이
                  있다면 수정 후 다시 분석하거나 저장할 수 있습니다.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      연도 (필수)
                    </label>
                    <input
                      type="text"
                      value={examYear}
                      onChange={(e) => setExamYear(e.target.value)}
                      placeholder="예: 2023"
                      className="w-full p-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      학기 (필수)
                    </label>
                    <input
                      type="text"
                      value={examTerm}
                      onChange={(e) => setExamTerm(e.target.value)}
                      placeholder="예: 1학기"
                      className="w-full p-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      시험종류 (필수)
                    </label>
                    <input
                      type="text"
                      value={examType}
                      onChange={(e) => setExamType(e.target.value)}
                      placeholder="예: 중간고사"
                      className="w-full p-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      학년 (선택)
                    </label>
                    <input
                      type="text"
                      value={examGrade}
                      onChange={(e) => setExamGrade(e.target.value)}
                      placeholder="예: 2학년"
                      className="w-full p-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800"
                    />
                  </div>
                </div>
                <button
                  onClick={handleParseExam}
                  disabled={isParsing}
                  className="w-full flex items-center justify-center gap-2 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {isParsing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <PlayCircle size={16} />
                  )}
                  {isParsing
                    ? "문항 재분석 중..."
                    : "입력한 정보로 문항 재분석하기"}
                </button>
              </div>

              {parsedQuestions && parsedQuestions.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-neutral-900 dark:text-neutral-100">
                      추출된 문항 ({parsedQuestions.length}개)
                    </h4>
                  </div>
                  <div className="space-y-3">
                    {parsedQuestions.map((q, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700"
                      >
                        <div className="font-bold text-sm text-blue-600 dark:text-blue-400 mb-1">
                          {q.id}
                        </div>
                        <div className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                          {q.questionText}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {parsedQuestions && (
              <div className="p-6 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setParsingExamFile(null);
                    setParsedQuestions(null);
                  }}
                  className="px-4 py-2 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg font-medium transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveParsedExam}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  저장 및 완료
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
