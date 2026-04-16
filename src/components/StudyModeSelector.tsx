import React from 'react';
import { useStudyMode, InterpretationMode, StudyModeSettings } from '../contexts/StudyModeContext';

interface Props {
  subjectId: string;
}

export const StudyModeSelector: React.FC<Props> = ({ subjectId }) => {
  const { getSettings, updateSettings } = useStudyMode();
  const settings = getSettings(subjectId);

  const handleChange = (key: keyof StudyModeSettings, value: InterpretationMode) => {
    updateSettings(subjectId, { ...settings, [key]: value });
  };

  const modes: { label: string; value: InterpretationMode }[] = [
    { label: '소극적 (매핑)', value: 'PASSIVE' },
    { label: '적극적 (표준)', value: 'ACTIVE' },
    { label: '확장적 (보완)', value: 'EXTENSIVE' },
  ];

  return (
    <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4">해석 모드 설정</h3>
      <div className="space-y-4">
        {(['lecture', 'recording', 'exam'] as const).map((key) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <label className="text-sm font-medium text-neutral-600 dark:text-neutral-400 capitalize">
              {key === 'exam' ? '기출문제' : key === 'lecture' ? '강의자료' : '녹음본'}
            </label>
            <select
              value={settings[key]}
              onChange={(e) => handleChange(key, e.target.value as InterpretationMode)}
              className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
            >
              {modes.map(mode => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
};
