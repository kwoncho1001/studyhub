import React, { createContext, useContext, useState } from 'react';

export type InterpretationMode = 'PASSIVE' | 'ACTIVE' | 'EXTENSIVE';

export interface StudyModeSettings {
  exam: InterpretationMode;
  lecture: InterpretationMode;
  recording: InterpretationMode;
}

export type SubjectStudyModeSettings = Record<string, StudyModeSettings>;

interface StudyModeContextType {
  getSettings: (subjectId: string) => StudyModeSettings;
  updateSettings: (subjectId: string, settings: StudyModeSettings) => void;
}

const StudyModeContext = createContext<StudyModeContextType | null>(null);

export const useStudyMode = () => {
  const ctx = useContext(StudyModeContext);
  if (!ctx) throw new Error('useStudyMode must be used within StudyModeProvider');
  return ctx;
};

export const StudyModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allSettings, setAllSettings] = useState<SubjectStudyModeSettings>({});

  const defaultSettings: StudyModeSettings = {
    exam: 'ACTIVE',
    lecture: 'ACTIVE',
    recording: 'ACTIVE',
  };

  const getSettings = (subjectId: string) => allSettings[subjectId] || defaultSettings;

  const updateSettings = (subjectId: string, settings: StudyModeSettings) => {
    setAllSettings(prev => ({ ...prev, [subjectId]: settings }));
  };

  return (
    <StudyModeContext.Provider value={{ getSettings, updateSettings }}>
      {children}
    </StudyModeContext.Provider>
  );
};
