import React, { useState, useEffect } from 'react';
import { Plus, BookOpen, Trash2, ChevronRight, Upload, Settings, Download } from 'lucide-react';
import { Subject, getSubjects, createSubject, deleteSubject, getGalleriesBySubject, importSubjectData, exportSubjectData } from '../lib/db';
import { motion } from 'motion/react';

interface HomeViewProps {
  onSelectSubject: (id: string) => void;
  onEditSubject: (id: string) => void;
}

interface SubjectWithStats extends Subject {
  galleryCount: number;
}

export function HomeView({ onSelectSubject, onEditSubject }: HomeViewProps) {
  const [subjects, setSubjects] = useState<SubjectWithStats[]>([]);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [subjectToDelete, setSubjectToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSubjects();
  }, []);

  const loadSubjects = async () => {
    const data = await getSubjects();
    const withStats = await Promise.all(
      data.map(async (s) => {
        const galleries = await getGalleriesBySubject(s.id);
        return { ...s, galleryCount: galleries.length };
      })
    );
    setSubjects(withStats.sort((a, b) => b.createdAt - a.createdAt));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    const newSubject = await createSubject(newSubjectName.trim());
    setNewSubjectName('');
    setIsCreating(false);
    await loadSubjects();
    onSelectSubject(newSubject.id);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSubjectToDelete(id);
  };

  const confirmDelete = async () => {
    if (subjectToDelete) {
      await deleteSubject(subjectToDelete);
      await loadSubjects();
      setSubjectToDelete(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let jsonString = '';
        if (file.name.endsWith('.gz')) {
          const decompressedStream = file.stream().pipeThrough(new DecompressionStream('gzip'));
          jsonString = await new Response(decompressedStream).text();
        } else {
          jsonString = await file.text();
        }
        
        await importSubjectData(jsonString);
        successCount++;
      } catch (err) {
        console.error(`Failed to import ${file.name}:`, err);
        setAlertMessage(`'${file.name}' 파일을 불러오는 중 오류가 발생했습니다: ` + (err instanceof Error ? err.message : String(err)));
      }
    }
    
    if (successCount > 0) {
      await loadSubjects();
    }
    
    e.target.value = '';
  };

  const toggleSubjectSelection = (id: string) => {
    const next = new Set(selectedSubjects);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSubjects(next);
  };

  const handleExport = async () => {
    for (const subjectId of selectedSubjects) {
      const data = await exportSubjectData(subjectId);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const subject = subjects.find(s => s.id === subjectId);
      a.href = url;
      a.download = `${subject?.name || 'subject'}_backup.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setIsExporting(false);
    setSelectedSubjects(new Set());
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 transition-colors duration-200">내 과목</h2>
          <p className="text-neutral-500 dark:text-neutral-400 transition-colors duration-200">학습할 과목을 선택하거나 새로 추가하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          {isExporting ? (
            <>
              <button
                onClick={() => { setIsExporting(false); setSelectedSubjects(new Set()); }}
                className="text-neutral-600 dark:text-neutral-400 px-4 py-2 rounded-lg font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleExport}
                disabled={selectedSubjects.size === 0}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                내보내기 완료
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsExporting(true)}
                className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Download size={18} />
                내보내기
              </button>
              <label className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer">
                <Upload size={18} />
                가져오기
                <input type="file" accept=".json,.gz" onChange={handleImport} className="hidden" multiple />
              </label>
              {!isCreating && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  <Plus size={18} />
                  새 과목 추가
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-neutral-900 p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex gap-4 items-end transition-colors duration-200">
          <div className="flex-1 space-y-2">
            <label htmlFor="subjectName" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">과목 이름</label>
            <input
              id="subjectName"
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="예: 컴퓨터 구조, 운영체제..."
              className="w-full px-4 py-2 border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400 outline-none transition-all placeholder-neutral-400 dark:placeholder-neutral-500"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!newSubjectName.trim()}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              추가
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjects.map((subject) => (
          <div
            key={subject.id}
            onClick={() => isExporting ? toggleSubjectSelection(subject.id) : onSelectSubject(subject.id)}
            className={`bg-white dark:bg-neutral-900 p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer group flex flex-col h-full ${isExporting && selectedSubjects.has(subject.id) ? 'border-green-500 ring-2 ring-green-200 dark:ring-green-900' : ''}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 p-3 rounded-lg transition-colors duration-200">
                <BookOpen size={24} />
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditSubject(subject.id);
                  }}
                  className="text-neutral-400 dark:text-neutral-500 hover:text-blue-500 dark:hover:text-blue-400 p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  title="과목 편집"
                >
                  <Settings size={18} />
                </button>
                <button
                  onClick={(e) => handleDelete(e, subject.id)}
                  className="text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="과목 삭제"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            <h3 className="font-bold text-lg mb-1 text-neutral-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{subject.name}</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 transition-colors duration-200">
              {new Date(subject.createdAt).toLocaleDateString()} 생성됨
            </p>
            
            <div className="mt-auto pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between transition-colors duration-200">
              <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                생성된 갤러리: <span className="text-blue-600 dark:text-blue-400 font-bold">{subject.galleryCount}</span>개
              </div>
              <div className="flex items-center text-sm font-medium text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                {isExporting ? (selectedSubjects.has(subject.id) ? '선택됨' : '선택하기') : '학습 시작하기'} <ChevronRight size={16} className="ml-1" />
              </div>
            </div>
          </div>
        ))}
        {subjects.length === 0 && !isCreating && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl transition-colors duration-200">
            <p className="text-neutral-500 dark:text-neutral-400 mb-4">아직 등록된 과목이 없습니다.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Plus size={18} />
              첫 과목 추가하기
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {subjectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">과목 삭제</h3>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm">정말로 이 과목을 삭제하시겠습니까? 관련된 모든 데이터가 삭제되며 복구할 수 없습니다.</p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setSubjectToDelete(null)}
                className="px-4 py-2 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
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
            <h3 className="font-bold text-lg text-neutral-900 dark:text-neutral-100">알림</h3>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm">{alertMessage}</p>
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
    </motion.div>
  );
}
