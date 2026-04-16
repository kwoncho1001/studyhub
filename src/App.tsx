import { useState } from 'react';
import { BookOpen, ChevronRight, Home, Moon, Sun, Loader2, X } from 'lucide-react';
import { HomeView } from './components/HomeView';
import { SubjectView } from './components/SubjectView';
import { GalleryView } from './components/GalleryView';
import { StudyRoom } from './components/StudyRoom';
import { ThemeProvider, useTheme } from './lib/ThemeContext';
import { UploadProvider, useUpload } from './contexts/UploadContext';
import { StudyModeProvider } from './contexts/StudyModeContext';

type ViewState = 'home' | 'subject' | 'gallery' | 'studyRoom';

function GlobalUploadProgress() {
  const { tasks, removeTask } = useUpload();
  
  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {tasks.map(task => (
        <div key={task.id} className={`p-4 rounded-xl shadow-lg border flex items-start gap-3 transition-colors duration-200 ${
          task.status === 'error' ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800/50' :
          task.status === 'done' ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800/50' :
          'bg-white border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700'
        }`}>
          {task.status === 'uploading' || task.status === 'analyzing' ? (
            <Loader2 className="animate-spin text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" size={18} />
          ) : task.status === 'error' ? (
            <div className="w-4 h-4 rounded-full bg-red-500 shrink-0 mt-1" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-green-500 shrink-0 mt-1" />
          )}
          
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${
              task.status === 'error' ? 'text-red-900 dark:text-red-200' :
              task.status === 'done' ? 'text-green-900 dark:text-green-200' :
              'text-neutral-900 dark:text-neutral-100'
            }`}>
              {task.fileName}
            </p>
            <p className={`text-xs mt-1 ${
              task.status === 'error' ? 'text-red-700 dark:text-red-300' :
              task.status === 'done' ? 'text-green-700 dark:text-green-300' :
              'text-neutral-500 dark:text-neutral-400'
            }`}>
              {task.status === 'error' ? task.error : task.progress}
            </p>
          </div>
          
          {(task.status === 'error' || task.status === 'done') && (
            <button 
              onClick={() => removeTask(task.id)}
              className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 shrink-0"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AppContent() {
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const navigateToHome = () => {
    setCurrentView('home');
    setActiveSubjectId(null);
    setActiveGalleryId(null);
  };

  const navigateToSubject = (subjectId: string) => {
    setActiveSubjectId(subjectId);
    setCurrentView('subject');
    setActiveGalleryId(null);
  };

  const navigateToGallery = (galleryId: string) => {
    setActiveGalleryId(galleryId);
    setCurrentView('gallery');
  };

  const navigateToStudyRoom = (subjectId: string) => {
    setActiveSubjectId(subjectId);
    setCurrentView('studyRoom');
    setActiveGalleryId(null);
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans selection:bg-blue-200 dark:selection:bg-blue-900 transition-colors duration-200">
      <header className="bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 sticky top-0 z-10 transition-colors duration-200">
        <div className={`${currentView === 'studyRoom' ? 'max-w-[1500px]' : 'max-w-6xl'} mx-auto px-4 h-16 flex items-center justify-between transition-all duration-300`}>
          <div 
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={navigateToHome}
          >
            <div className="bg-blue-600 text-white p-1.5 rounded-lg">
              <BookOpen size={20} />
            </div>
            <h1 className="font-bold text-xl tracking-tight">DC Study Hub</h1>
          </div>
          
          <div className="flex items-center gap-4 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            <div className="flex items-center gap-2">
              <button 
                onClick={navigateToHome}
                className={`flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors ${currentView === 'home' ? 'text-blue-600 dark:text-blue-400' : ''}`}
              >
                <Home size={16} />
                홈
              </button>
              
              {activeSubjectId && currentView !== 'studyRoom' && (
                <>
                  <ChevronRight size={16} className="text-neutral-300 dark:text-neutral-600" />
                  <button 
                    onClick={() => navigateToSubject(activeSubjectId)}
                    className={`hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors ${currentView === 'subject' ? 'text-blue-600 dark:text-blue-400' : ''}`}
                  >
                    과목 편집
                  </button>
                </>
              )}
              
              {activeSubjectId && currentView === 'studyRoom' && (
                <>
                  <ChevronRight size={16} className="text-neutral-300 dark:text-neutral-600" />
                  <span className="text-blue-600 dark:text-blue-400">
                    학습하기
                  </span>
                </>
              )}
              
              {activeGalleryId && (
                <>
                  <ChevronRight size={16} className="text-neutral-300 dark:text-neutral-600" />
                  <span className="text-blue-600 dark:text-blue-400">
                    갤러리 상세
                  </span>
                </>
              )}
            </div>

            <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700"></div>

            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className={`${currentView === 'studyRoom' ? 'max-w-[1500px]' : 'max-w-6xl'} mx-auto px-4 py-8 transition-all duration-300`}>
        {currentView === 'home' && (
          <HomeView 
            onSelectSubject={navigateToStudyRoom} 
            onEditSubject={navigateToSubject}
          />
        )}
        
        {currentView === 'subject' && activeSubjectId && (
          <SubjectView 
            subjectId={activeSubjectId} 
          />
        )}
        
        {currentView === 'gallery' && activeGalleryId && (
          <GalleryView galleryId={activeGalleryId} />
        )}

        {currentView === 'studyRoom' && activeSubjectId && (
          <StudyRoom subjectId={activeSubjectId} onEditSubject={navigateToSubject} />
        )}
      </main>
      
      <GlobalUploadProgress />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UploadProvider>
        <StudyModeProvider>
          <AppContent />
        </StudyModeProvider>
      </UploadProvider>
    </ThemeProvider>
  );
}
